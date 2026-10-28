import { hydrateLearning, type FlashBackup } from '../flashcards/backup';
import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { createDefaultMetadata, createDefaultSettings } from '#lib/domain/defaults.js';
import { migrateStoredSnapshot, StoredDataError } from '#lib/domain/migrations.js';
import type {
	AppMetadata,
	AppSnapshot,
	AttemptRecord,
	SessionRecord,
	Settings
} from '#lib/domain/types.js';

const DATABASE_NAME = 'think-fast';
const DATABASE_VERSION = 4;
const CURRENT_KEY = 'current';

interface ThinkFastDatabase extends DBSchema {
	flashLearning: { key: string; value: import('../flashcards/scheduler').Learning };
	flashReviews: {
		key: string;
		value: import('../flashcards/scheduler').Review;
		indexes: { 'by-deck': string };
	};
	flashDecks: { key: string; value: import('../flashcards/repository').Deck };
	flashCards: {
		key: string;
		value: import('../flashcards/repository').Card;
		indexes: { 'by-deck': string };
	};
	flashProgress: { key: string; value: { id: string; studiedAt: string } };
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

export function getDatabase(): Promise<IDBPDatabase<ThinkFastDatabase>> {
	if (!databasePromise) {
		databasePromise = openDB<ThinkFastDatabase>(DATABASE_NAME, DATABASE_VERSION, {
			upgrade(database) {
				if (!database.objectStoreNames.contains('flashLearning'))
					database.createObjectStore('flashLearning', { keyPath: 'id' });
				if (!database.objectStoreNames.contains('flashReviews'))
					database
						.createObjectStore('flashReviews', { keyPath: 'id' })
						.createIndex('by-deck', 'deckId');
				if (!database.objectStoreNames.contains('flashDecks'))
					database.createObjectStore('flashDecks', { keyPath: 'id' });
				if (!database.objectStoreNames.contains('flashProgress'))
					database.createObjectStore('flashProgress', { keyPath: 'id' });
				if (!database.objectStoreNames.contains('flashCards'))
					database
						.createObjectStore('flashCards', { keyPath: 'id' })
						.createIndex('by-deck', 'deckId');
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

export async function replaceAllData(
	snapshot: AppSnapshot,
	flashcards?: FlashBackup,
	mode: 'merge' | 'replace' = 'replace'
): Promise<void> {
	const database = await getDatabase();
	const transaction = database.transaction(
		[
			'settings',
			'sessions',
			'attempts',
			'metadata',
			'flashDecks',
			'flashCards',
			'flashProgress',
			'flashLearning',
			'flashReviews'
		],
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
	if (flashcards) {
		if (mode === 'replace')
			for (const store of [
				'flashDecks',
				'flashCards',
				'flashProgress',
				'flashLearning',
				'flashReviews'
			] as const)
				await transaction.objectStore(store).clear();
		for (const deck of flashcards.decks)
			if (mode === 'replace' || !(await transaction.objectStore('flashDecks').get(deck.id)))
				await transaction.objectStore('flashDecks').put(deck);
		for (const card of flashcards.cards)
			if (mode === 'replace' || !(await transaction.objectStore('flashCards').get(card.id)))
				await transaction.objectStore('flashCards').put(card);
		for (const progress of flashcards.progress)
			if (mode === 'replace' || !(await transaction.objectStore('flashProgress').get(progress.id)))
				await transaction.objectStore('flashProgress').put(progress);
		for (const state of flashcards.learning)
			if (mode === 'replace' || !(await transaction.objectStore('flashLearning').get(state.id)))
				await transaction.objectStore('flashLearning').put(hydrateLearning(state));
		for (const review of flashcards.reviews)
			if (mode === 'replace' || !(await transaction.objectStore('flashReviews').get(review.id)))
				await transaction.objectStore('flashReviews').put({
					...review,
					next: hydrateLearning(review.next),
					previous: review.previous ? hydrateLearning(review.previous) : undefined
				});
	}
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
