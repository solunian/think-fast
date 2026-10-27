import { getContext, setContext } from 'svelte';
import {
	beginSession as persistSessionStart,
	deleteAllLocalData,
	finalizeSession as persistSessionEnd,
	initializeFresh,
	markExportSuccessful,
	probeRepository,
	replaceAllData,
	saveAttempt as persistAttempt,
	saveSettings as persistSettings
} from '#lib/data/repository.js';
import type {
	AppSnapshot,
	AttemptRecord,
	SessionRecord,
	Settings,
	ThinkFastBackup
} from '#lib/domain/types.js';
import {
	backupToSnapshot,
	mergeBackup,
	serializeBackup,
	triggerJsonDownload
} from '#lib/services/backup.js';

export type AppStatus = 'loading' | 'empty' | 'ready' | 'corrupt';

export class AppState {
	status = $state<AppStatus>('loading');
	snapshot = $state.raw<AppSnapshot | null>(null);
	recoveryRaw = $state.raw<unknown>(null);
	recoveryMessage = $state('');
	notice = $state('');
	private noticeTimer: ReturnType<typeof setTimeout> | null = null;

	get settings(): Settings | null {
		return this.snapshot?.settings ?? null;
	}

	get hasUnexportedChanges(): boolean {
		return this.snapshot?.metadata.hasUnexportedChanges ?? false;
	}

	async initialize(): Promise<void> {
		this.status = 'loading';
		const result = await probeRepository();
		if (result.kind === 'ready') {
			this.snapshot = result.snapshot;
			this.status = 'ready';
			this.showNotice('Local progress loaded.');
		} else if (result.kind === 'empty') {
			this.status = 'empty';
		} else {
			this.recoveryRaw = result.raw;
			this.recoveryMessage = result.message;
			this.status = 'corrupt';
		}
	}

	async startFresh(): Promise<void> {
		this.snapshot = await initializeFresh();
		this.status = 'ready';
		this.recoveryRaw = null;
		this.showNotice('Fresh local workspace created.');
	}

	async updateSettings(patch: Partial<Settings>): Promise<void> {
		if (!this.snapshot) return;
		const settings: Settings = {
			...this.snapshot.settings,
			...patch,
			backup: patch.backup ?? this.snapshot.settings.backup
		};
		const metadata = await persistSettings(settings);
		this.snapshot = { ...this.snapshot, settings, metadata };
	}

	async beginSession(session: SessionRecord): Promise<void> {
		if (!this.snapshot) throw new Error('Local data is not ready.');
		const metadata = await persistSessionStart(session);
		this.snapshot = {
			...this.snapshot,
			sessions: [...this.snapshot.sessions.filter((item) => item.id !== session.id), session],
			metadata
		};
	}

	async addAttempt(attempt: AttemptRecord, sessionCheckpoint?: SessionRecord): Promise<void> {
		if (!this.snapshot) throw new Error('Local data is not ready.');
		const metadata = await persistAttempt(attempt, sessionCheckpoint);
		this.snapshot = {
			...this.snapshot,
			attempts: [...this.snapshot.attempts.filter((item) => item.id !== attempt.id), attempt],
			sessions: sessionCheckpoint
				? [
						...this.snapshot.sessions.filter((item) => item.id !== sessionCheckpoint.id),
						sessionCheckpoint
					]
				: this.snapshot.sessions,
			metadata
		};
	}

	async finishSession(session: SessionRecord): Promise<void> {
		if (!this.snapshot) throw new Error('Local data is not ready.');
		const metadata = await persistSessionEnd(session);
		this.snapshot = {
			...this.snapshot,
			sessions: [...this.snapshot.sessions.filter((item) => item.id !== session.id), session],
			metadata
		};
	}

	async exportBackup(): Promise<void> {
		if (!this.snapshot) throw new Error('There is no local data to export.');
		const exportedAt = new Date().toISOString();
		triggerJsonDownload(serializeBackup(this.snapshot, exportedAt), exportedAt);
		const metadata = await markExportSuccessful(exportedAt);
		this.snapshot = {
			...this.snapshot,
			settings: { ...this.snapshot.settings, backup: { lastExportAt: exportedAt } },
			metadata
		};
		this.showNotice(`Backup download started at ${new Date(exportedAt).toLocaleTimeString()}.`);
	}

	async importBackup(backup: ThinkFastBackup, mode: 'replace' | 'merge'): Promise<void> {
		const now = new Date().toISOString();
		const next =
			mode === 'merge' && this.snapshot
				? mergeBackup(this.snapshot, backup, now)
				: backupToSnapshot(backup, now);
		await replaceAllData(next);
		this.snapshot = next;
		this.status = 'ready';
		this.recoveryRaw = null;
		this.showNotice(
			mode === 'merge'
				? 'Backup merged with local progress.'
				: 'Local progress replaced from backup.'
		);
	}

	async resetToWelcome(): Promise<void> {
		await deleteAllLocalData();
		this.snapshot = null;
		this.recoveryRaw = null;
		this.recoveryMessage = '';
		this.status = 'empty';
		this.showNotice('All local Think Fast data was deleted.');
	}

	showNotice(message: string): void {
		this.notice = message;
		if (this.noticeTimer) clearTimeout(this.noticeTimer);
		this.noticeTimer = setTimeout(() => {
			this.notice = '';
		}, 5_000);
	}
}

const APP_STATE_KEY = Symbol('think-fast-app-state');

export function provideAppState(state: AppState): AppState {
	setContext(APP_STATE_KEY, state);
	return state;
}

export function useAppState(): AppState {
	const state = getContext<AppState>(APP_STATE_KEY);
	if (!state) throw new Error('Think Fast app state is not available.');
	return state;
}
