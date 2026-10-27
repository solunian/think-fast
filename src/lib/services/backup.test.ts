import { describe, expect, test } from 'vitest';
import { createDefaultMetadata, createDefaultSettings } from '#lib/domain/defaults.js';
import type { AppSnapshot, AttemptRecord, SessionRecord } from '#lib/domain/types.js';
import {
	BackupError,
	createBackup,
	mergeBackup,
	serializeBackup,
	validateBackupText
} from './backup';

const timestamp = '2026-08-31T18:30:00.000Z';
const session: SessionRecord = {
	id: 'session-1',
	exerciseType: 'mental-math',
	category: 'mixed',
	startedAt: timestamp,
	endedAt: '2026-08-31T18:31:00.000Z',
	activeDurationMs: 60_000,
	configuredDurationMs: 60_000,
	attemptedCount: 1,
	correctCount: 1,
	incorrectCount: 0,
	skippedCount: 0,
	averageResponseMs: 800,
	medianResponseMs: 800,
	completionReason: 'timer-expired',
	difficulty: 'standard',
	configuration: {}
};
const attempt: AttemptRecord = {
	id: 'attempt-1',
	sessionId: session.id,
	exerciseType: 'mental-math',
	problemCategory: 'addition',
	prompt: '1 + 1',
	submittedAnswer: 2,
	expectedAnswer: 2,
	correct: true,
	responseTimeMs: 800,
	difficulty: 'standard',
	timestamp
};
const snapshot: AppSnapshot = {
	settings: createDefaultSettings(),
	sessions: [session],
	attempts: [attempt],
	metadata: createDefaultMetadata(timestamp)
};

describe('backup service', () => {
	test('serializes and validates a complete versioned backup', () => {
		const text = serializeBackup(snapshot, timestamp);
		const backup = validateBackupText(text);
		expect(backup.format).toBe('think-fast-backup');
		expect(backup.version).toBe(1);
		expect(backup.sessions).toEqual([session]);
		expect(backup.attempts).toEqual([attempt]);
	});

	test('rejects unrelated JSON and unsupported future versions clearly', () => {
		expect(() => validateBackupText('{"hello":"world"}')).toThrow(BackupError);
		expect(() =>
			validateBackupText(JSON.stringify({ format: 'think-fast-backup', version: 99 }))
		).toThrow(/newer/);
	});

	test('merges by stable ID without duplicates', () => {
		const backup = createBackup(snapshot, timestamp);
		const merged = mergeBackup(snapshot, backup, '2026-09-01T00:00:00.000Z');
		expect(merged.sessions).toHaveLength(1);
		expect(merged.attempts).toHaveLength(1);
		expect(merged.metadata.hasUnexportedChanges).toBe(true);
	});
});
