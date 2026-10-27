import { backupSchema } from '#lib/domain/schemas.js';
import {
	APP_VERSION,
	CURRENT_SCHEMA_VERSION,
	type AppSnapshot,
	type BackupPreview,
	type ThinkFastBackup
} from '#lib/domain/types.js';

export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export class BackupError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BackupError';
	}
}

export function createBackup(
	snapshot: AppSnapshot,
	exportedAt = new Date().toISOString()
): ThinkFastBackup {
	return {
		format: 'think-fast-backup',
		version: 1,
		exportedAt,
		appVersion: APP_VERSION,
		settings: structuredClone(snapshot.settings),
		sessions: structuredClone(snapshot.sessions),
		attempts: structuredClone(snapshot.attempts),
		metadata: structuredClone(snapshot.metadata)
	};
}

export function serializeBackup(snapshot: AppSnapshot, exportedAt?: string): string {
	return JSON.stringify(createBackup(snapshot, exportedAt), null, 2);
}

export function validateBackupText(text: string): ThinkFastBackup {
	if (new Blob([text]).size > MAX_BACKUP_BYTES) {
		throw new BackupError('This file is larger than the 10 MB import limit.');
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new BackupError('The selected file is not valid JSON.');
	}

	if (parsed && typeof parsed === 'object') {
		const candidate = parsed as Record<string, unknown>;
		if (candidate.format !== 'think-fast-backup') {
			throw new BackupError('This is not a Think Fast backup file.');
		}
		if (typeof candidate.version === 'number' && candidate.version > 1) {
			throw new BackupError(
				'This backup was created by a newer, unsupported version of Think Fast.'
			);
		}
	}

	const result = backupSchema.safeParse(parsed);
	if (!result.success) {
		const issue = result.error.issues[0];
		throw new BackupError(`Backup validation failed${issue ? `: ${issue.message}` : '.'}`);
	}
	return result.data;
}

export function previewBackup(backup: ThinkFastBackup): BackupPreview {
	const dates = backup.sessions.map((session) => session.startedAt).sort();
	return {
		exportedAt: backup.exportedAt,
		sessionCount: backup.sessions.length,
		attemptCount: backup.attempts.length,
		dateRange: dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null
	};
}

export function backupToSnapshot(
	backup: ThinkFastBackup,
	now = new Date().toISOString()
): AppSnapshot {
	return {
		settings: { ...structuredClone(backup.settings), schemaVersion: CURRENT_SCHEMA_VERSION },
		sessions: structuredClone(backup.sessions),
		attempts: structuredClone(backup.attempts),
		metadata: {
			...structuredClone(backup.metadata),
			schemaVersion: CURRENT_SCHEMA_VERSION,
			lastModifiedAt: now,
			hasUnexportedChanges: true
		}
	};
}

export function mergeBackup(
	current: AppSnapshot,
	backup: ThinkFastBackup,
	now = new Date().toISOString()
): AppSnapshot {
	const sessions = new Map(current.sessions.map((session) => [session.id, session]));
	const attempts = new Map(current.attempts.map((attempt) => [attempt.id, attempt]));
	for (const session of backup.sessions)
		if (!sessions.has(session.id)) sessions.set(session.id, session);
	for (const attempt of backup.attempts)
		if (!attempts.has(attempt.id)) attempts.set(attempt.id, attempt);
	return {
		settings: { ...structuredClone(backup.settings), schemaVersion: CURRENT_SCHEMA_VERSION },
		sessions: [...sessions.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
		attempts: [...attempts.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
		metadata: {
			...current.metadata,
			createdAt:
				current.metadata.createdAt < backup.metadata.createdAt
					? current.metadata.createdAt
					: backup.metadata.createdAt,
			lastModifiedAt: now,
			hasUnexportedChanges: true
		}
	};
}

function filenameTimestamp(iso: string): string {
	return iso.replace(/\.\d{3}Z$/, '').replaceAll(':', '');
}

export function triggerJsonDownload(contents: string, exportedAt: string): void {
	const blob = new Blob([contents], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = `think-fast-backup-${filenameTimestamp(exportedAt)}.json`;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function triggerRawRecoveryDownload(raw: unknown): void {
	const timestamp = new Date().toISOString();
	const blob = new Blob([JSON.stringify({ recoveredAt: timestamp, raw }, null, 2)], {
		type: 'application/json'
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = `think-fast-recovery-${filenameTimestamp(timestamp)}.json`;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function createStatisticsCsv(snapshot: AppSnapshot): string {
	const header = [
		'session_id',
		'exercise',
		'category',
		'started_at',
		'active_ms',
		'attempted',
		'correct',
		'accuracy_percent',
		'average_response_ms',
		'difficulty',
		'completion_reason'
	];
	const rows = snapshot.sessions.map((session) => [
		session.id,
		session.exerciseType,
		session.category,
		session.startedAt,
		session.activeDurationMs,
		session.attemptedCount,
		session.correctCount,
		session.attemptedCount
			? ((session.correctCount / session.attemptedCount) * 100).toFixed(2)
			: '0',
		session.averageResponseMs.toFixed(0),
		session.difficulty,
		session.completionReason
	]);
	return [header, ...rows]
		.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
		.join('\n');
}

export function triggerCsvDownload(snapshot: AppSnapshot): void {
	const now = new Date().toISOString();
	const blob = new Blob([createStatisticsCsv(snapshot)], { type: 'text/csv' });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = `think-fast-statistics-${filenameTimestamp(now)}.csv`;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
