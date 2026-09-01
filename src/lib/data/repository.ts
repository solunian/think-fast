import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { createDefaultMetadata, createDefaultSettings } from '$lib/domain/defaults';
import { migrateStoredSnapshot, StoredDataError } from '$lib/domain/migrations';
import type {
	AppMetadata,
	AppSnapshot,
	AttemptRecord,
	SessionRecord,
	Settings
} from '$lib/domain/types';

const DATABASE_NAME = 'think-fast';
const DATABASE_VERSION = 2;
const CURRENT_KEY = 'current';

interface ThinkFastDatabase extends DBSchema {
	settings: { key: string; value: Settings };
	sessions: {
		key: string;
		value: SessionRecord;
		indexes: { 'by-started-at': string; 'by-exercise': string };
	};
	attempts: {
		key: string;
		value: AttemptRecord;
		indexes: { 'by-session': string; 'by-timestamp': string };
	};
	metadata: { key: string; value: AppMetadata };
}

export type RepositoryProbe =
	| { kind: 'empty' }
	| { kind: 'ready'; snapshot: AppSnapshot }
	| { kind: 'corrupt'; message: string; raw: unknown };

let databasePromise: Promise<IDBPDatabase<ThinkFastDatabase>> | null = null;

function getDatabase(): Promise<IDBPDatabase<ThinkFastDatabase>> {
	if (!databasePromise) {
		databasePromise = openDB<ThinkFastDatabase>(DATABASE_NAME, DATABASE_VERSION, {
			upgrade(database) {
				if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings');
				if (!database.objectStoreNames.contains('metadata')) database.createObjectStore('metadata');

				if (!database.objectStoreNames.contains('sessions')) {
					const sessions = database.createObjectStore('sessions', { keyPath: 'id' });
					sessions.createIndex('by-started-at', 'startedAt');
					sessions.createIndex('by-exercise', 'exerciseType');
				}

				if (!database.objectStoreNames.contains('attempts')) {
					const attempts = database.createObjectStore('attempts', { keyPath: 'id' });
					attempts.createIndex('by-session', 'sessionId');
					attempts.createIndex('by-timestamp', 'timestamp');
				}
			}
		});
	}
	return databasePromise;
}

async function readRawData() {
	const database = await getDatabase();
	const transaction = database.transaction(
		['settings', 'sessions', 'attempts', 'metadata'],
		'readonly'
	);
	const [settings, sessions, attempts, metadata] = await Promise.all([
		transaction.objectStore('settings').get(CURRENT_KEY),
		transaction.objectStore('sessions').getAll(),
		transaction.objectStore('attempts').getAll(),
		transaction.objectStore('metadata').get(CURRENT_KEY)
	]);
	await transaction.done;
	return { settings, sessions, attempts, metadata };
}

export async function probeRepository(): Promise<RepositoryProbe> {
	try {
		const raw = await readRawData();
		if (!raw.settings && !raw.metadata && raw.sessions.length === 0 && raw.attempts.length === 0) {
			return { kind: 'empty' };
		}
		if (!raw.settings) {
			return { kind: 'corrupt', message: 'Local settings are missing.', raw };
		}
		return { kind: 'ready', snapshot: migrateStoredSnapshot(raw) };
	} catch (error) {
		if (error instanceof StoredDataError) {
			return { kind: 'corrupt', message: error.message, raw: error.raw };
		}
		return {
			kind: 'corrupt',
			message: error instanceof Error ? error.message : 'IndexedDB could not be read.',
			raw: { error: String(error) }
		};
	}
}

export async function initializeFresh(): Promise<AppSnapshot> {
	const now = new Date().toISOString();
	const snapshot: AppSnapshot = {
		settings: createDefaultSettings(),
		sessions: [],
		attempts: [],
		metadata: createDefaultMetadata(now)
	};
	await replaceAllData(snapshot);
	return snapshot;
}

export async function replaceAllData(snapshot: AppSnapshot): Promise<void> {
	const database = await getDatabase();
	const transaction = database.transaction(
		['settings', 'sessions', 'attempts', 'metadata'],
		'readwrite'
	);
	await Promise.all([
		transaction.objectStore('settings').clear(),
		transaction.objectStore('sessions').clear(),
		transaction.objectStore('attempts').clear(),
		transaction.objectStore('metadata').clear()
	]);
	await transaction.objectStore('settings').put(snapshot.settings, CURRENT_KEY);
	await transaction.objectStore('metadata').put(snapshot.metadata, CURRENT_KEY);
	for (const session of snapshot.sessions) await transaction.objectStore('sessions').put(session);
	for (const attempt of snapshot.attempts) await transaction.objectStore('attempts').put(attempt);
	await transaction.done;
}

function dirtyMetadata(metadata: AppMetadata | undefined): AppMetadata {
	const now = new Date().toISOString();
	return {
		...(metadata ?? createDefaultMetadata(now)),
		lastModifiedAt: now,
		hasUnexportedChanges: true
	};
}

export async function saveSettings(settings: Settings): Promise<AppMetadata> {
	const database = await getDatabase();
	const transaction = database.transaction(['settings', 'metadata'], 'readwrite');
	const metadata = dirtyMetadata(await transaction.objectStore('metadata').get(CURRENT_KEY));
	await Promise.all([
		transaction.objectStore('settings').put(settings, CURRENT_KEY),
		transaction.objectStore('metadata').put(metadata, CURRENT_KEY)
	]);
	await transaction.done;
	return metadata;
}

export async function beginSession(session: SessionRecord): Promise<AppMetadata> {
	const database = await getDatabase();
	const transaction = database.transaction(['sessions', 'metadata'], 'readwrite');
	const metadata = dirtyMetadata(await transaction.objectStore('metadata').get(CURRENT_KEY));
	await Promise.all([
		transaction.objectStore('sessions').put(session),
		transaction.objectStore('metadata').put(metadata, CURRENT_KEY)
	]);
	await transaction.done;
	return metadata;
}

export async function saveAttempt(
	attempt: AttemptRecord,
	sessionCheckpoint?: SessionRecord
): Promise<AppMetadata> {
	const database = await getDatabase();
	const transaction = database.transaction(['attempts', 'sessions', 'metadata'], 'readwrite');
	const metadata = dirtyMetadata(await transaction.objectStore('metadata').get(CURRENT_KEY));
	const writes: Promise<unknown>[] = [
		transaction.objectStore('attempts').put(attempt),
		transaction.objectStore('metadata').put(metadata, CURRENT_KEY)
	];
	if (sessionCheckpoint) writes.push(transaction.objectStore('sessions').put(sessionCheckpoint));
	await Promise.all(writes);
	await transaction.done;
	return metadata;
}

export async function finalizeSession(session: SessionRecord): Promise<AppMetadata> {
	const database = await getDatabase();
	const transaction = database.transaction(['sessions', 'metadata'], 'readwrite');
	const metadata = dirtyMetadata(await transaction.objectStore('metadata').get(CURRENT_KEY));
	await Promise.all([
		transaction.objectStore('sessions').put(session),
		transaction.objectStore('metadata').put(metadata, CURRENT_KEY)
	]);
	await transaction.done;
	return metadata;
}

export async function markExportSuccessful(exportedAt: string): Promise<AppMetadata> {
	const database = await getDatabase();
	const transaction = database.transaction(['settings', 'metadata'], 'readwrite');
	const existingSettings = await transaction.objectStore('settings').get(CURRENT_KEY);
	const existingMetadata = await transaction.objectStore('metadata').get(CURRENT_KEY);
	if (!existingSettings || !existingMetadata) throw new Error('Local data is not initialized.');
	const settings = { ...existingSettings, backup: { lastExportAt: exportedAt } };
	const metadata = {
		...existingMetadata,
		lastSuccessfulExportAt: exportedAt,
		hasUnexportedChanges: false
	};
	await Promise.all([
		transaction.objectStore('settings').put(settings, CURRENT_KEY),
		transaction.objectStore('metadata').put(metadata, CURRENT_KEY)
	]);
	await transaction.done;
	return metadata;
}

export async function deleteAllLocalData(): Promise<void> {
	if (databasePromise) {
		const database = await databasePromise;
		database.close();
		databasePromise = null;
	}
	await deleteDB(DATABASE_NAME);
}

export async function getRawRecoveryData(): Promise<unknown> {
	return readRawData();
}
