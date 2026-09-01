import { describe, expect, test } from 'vitest';
import { createDefaultSettings } from './defaults';
import { migrateStoredSnapshot, StoredDataError } from './migrations';

const timestamp = '2026-08-31T18:30:00.000Z';

describe('schema migration', () => {
	test('fills historical fields and advances schema versions', () => {
		const legacySettings = { ...createDefaultSettings(), schemaVersion: 1 } as Record<
			string,
			unknown
		>;
		delete legacySettings.backup;
		const migrated = migrateStoredSnapshot({
			settings: legacySettings,
			sessions: [
				{
					id: 'old-session',
					exerciseType: 'mental-math',
					category: 'mixed',
					startedAt: timestamp,
					endedAt: timestamp,
					activeDurationMs: 0,
					configuredDurationMs: 60_000,
					attemptedCount: 0,
					correctCount: 0,
					incorrectCount: 0,
					averageResponseMs: 0,
					medianResponseMs: 0,
					completionReason: 'interrupted',
					difficulty: 'standard'
				}
			],
			attempts: [],
			metadata: undefined
		});
		expect(migrated.settings.schemaVersion).toBe(2);
		expect(migrated.settings.backup.lastExportAt).toBeNull();
		expect(migrated.sessions[0].skippedCount).toBe(0);
		expect(migrated.sessions[0].configuration).toEqual({});
	});

	test('surfaces invalid partial data rather than deleting it', () => {
		expect(() =>
			migrateStoredSnapshot({
				settings: { theme: 'broken' },
				sessions: [],
				attempts: [],
				metadata: {}
			})
		).toThrow(StoredDataError);
	});
});
