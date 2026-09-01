import { createDefaultMetadata, createDefaultSettings } from './defaults';
import { attemptSchema, metadataSchema, sessionSchema, settingsSchema } from './schemas';
import { CURRENT_SCHEMA_VERSION, type AppSnapshot } from './types';

export class StoredDataError extends Error {
	constructor(
		message: string,
		public readonly raw: unknown
	) {
		super(message);
		this.name = 'StoredDataError';
	}
}

function migrateSettings(raw: unknown): unknown {
	if (!raw || typeof raw !== 'object') return raw;
	const source = raw as Record<string, unknown>;
	const defaults = createDefaultSettings();
	return {
		...defaults,
		...source,
		schemaVersion: CURRENT_SCHEMA_VERSION,
		backup: {
			...defaults.backup,
			...(source.backup && typeof source.backup === 'object' ? source.backup : {})
		}
	};
}

function migrateSession(raw: unknown): unknown {
	if (!raw || typeof raw !== 'object') return raw;
	const source = raw as Record<string, unknown>;
	return {
		skippedCount: 0,
		configuration: {},
		...source
	};
}

function migrateAttempt(raw: unknown): unknown {
	if (!raw || typeof raw !== 'object') return raw;
	const source = raw as Record<string, unknown>;
	return { responseTimeMs: 0, ...source };
}

function migrateMetadata(raw: unknown, fallbackDate: string): unknown {
	if (!raw || typeof raw !== 'object') {
		return createDefaultMetadata(fallbackDate);
	}
	const source = raw as Record<string, unknown>;
	return {
		...createDefaultMetadata(fallbackDate),
		...source,
		schemaVersion: CURRENT_SCHEMA_VERSION
	};
}

export function migrateStoredSnapshot(raw: {
	settings: unknown;
	sessions: unknown[];
	attempts: unknown[];
	metadata: unknown;
}): AppSnapshot {
	const fallbackDate = new Date().toISOString();
	const settings = settingsSchema.safeParse(migrateSettings(raw.settings));
	const sessions = sessionSchema.array().safeParse(raw.sessions.map(migrateSession));
	const attempts = attemptSchema.array().safeParse(raw.attempts.map(migrateAttempt));
	const metadata = metadataSchema.safeParse(migrateMetadata(raw.metadata, fallbackDate));

	if (!settings.success || !sessions.success || !attempts.success || !metadata.success) {
		const reasons = [
			!settings.success ? 'settings' : '',
			!sessions.success ? 'sessions' : '',
			!attempts.success ? 'attempts' : '',
			!metadata.success ? 'metadata' : ''
		].filter(Boolean);
		throw new StoredDataError(`Invalid local ${reasons.join(', ')} data.`, raw);
	}

	return {
		settings: settings.data,
		sessions: sessions.data,
		attempts: attempts.data,
		metadata: metadata.data
	};
}
