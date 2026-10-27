<script lang="ts">
	import { useAppState } from '#lib/app-state.svelte.js';
	import type { BackupPreview, ThinkFastBackup } from '#lib/domain/types.js';
	import {
		BackupError,
		MAX_BACKUP_BYTES,
		previewBackup,
		validateBackupText
	} from '#lib/services/backup.js';

	let { label = 'Import progress file', onimported }: { label?: string; onimported?: () => void } =
		$props();
	const app = useAppState();
	let input = $state<HTMLInputElement>();
	let backup = $state.raw<ThinkFastBackup | null>(null);
	let preview = $state.raw<BackupPreview | null>(null);
	let error = $state('');
	let busy = $state(false);
	let replaceConfirmed = $state(false);

	function chooseFile() {
		input?.click();
	}

	async function readFile(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		const file = target.files?.[0];
		backup = null;
		preview = null;
		error = '';
		replaceConfirmed = false;
		if (!file) return;
		if (file.size > MAX_BACKUP_BYTES) {
			error = 'This file is larger than the 10 MB import limit.';
			return;
		}
		try {
			const validated = validateBackupText(await file.text());
			backup = validated;
			preview = previewBackup(validated);
		} catch (cause) {
			error = cause instanceof BackupError ? cause.message : 'The backup could not be read.';
		}
	}

	async function performImport(mode: 'replace' | 'merge') {
		if (!backup || (mode === 'replace' && !replaceConfirmed)) return;
		busy = true;
		error = '';
		try {
			await app.importBackup(backup, mode);
			backup = null;
			preview = null;
			if (input) input.value = '';
			onimported?.();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Import failed without changing local data.';
		} finally {
			busy = false;
		}
	}

	function cancel() {
		backup = null;
		preview = null;
		error = '';
		replaceConfirmed = false;
		if (input) input.value = '';
	}
</script>

<div class="grid gap-3">
	<input
		bind:this={input}
		class="sr-only"
		type="file"
		accept="application/json,.json"
		onchange={readFile}
		aria-describedby="import-help import-error"
		data-testid="backup-file-input"
	/>
	<button class="btn-secondary" type="button" onclick={chooseFile}>{label}</button>
	<p id="import-help" class="text-xs text-[var(--muted)]">Think Fast JSON files up to 10 MB.</p>

	{#if error}
		<p id="import-error" class="text-sm font-semibold text-[var(--danger)]" role="alert">{error}</p>
	{/if}

	{#if backup && preview}
		<section
			class="surface grid gap-4 rounded-md border-l-4 border-l-[var(--accent)] p-4"
			aria-labelledby="import-preview-title"
		>
			<div>
				<p class="eyebrow">Validated backup</p>
				<h3 id="import-preview-title" class="mt-1 text-lg font-bold">Import preview</h3>
			</div>
			<dl class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
				<div>
					<dt class="text-[var(--muted)]">Backup date</dt>
					<dd class="mt-1 font-semibold">{new Date(preview.exportedAt).toLocaleDateString()}</dd>
				</div>
				<div>
					<dt class="text-[var(--muted)]">Sessions</dt>
					<dd class="mono mt-1 font-semibold">{preview.sessionCount}</dd>
				</div>
				<div>
					<dt class="text-[var(--muted)]">Attempts</dt>
					<dd class="mono mt-1 font-semibold">{preview.attemptCount}</dd>
				</div>
				<div>
					<dt class="text-[var(--muted)]">Coverage</dt>
					<dd class="mt-1 font-semibold">
						{preview.dateRange
							? `${new Date(preview.dateRange.start).toLocaleDateString()}–${new Date(preview.dateRange.end).toLocaleDateString()}`
							: 'No sessions'}
					</dd>
				</div>
			</dl>
			<label class="flex items-start gap-3 text-sm">
				<input class="mt-1 size-4" type="checkbox" bind:checked={replaceConfirmed} />
				<span>I understand that replacing will remove current local progress first.</span>
			</label>
			<div class="flex flex-wrap gap-2">
				<button
					class="btn-danger"
					type="button"
					onclick={() => performImport('replace')}
					disabled={busy || !replaceConfirmed}>Replace local data</button
				>
				<button
					class="btn-primary"
					type="button"
					onclick={() => performImport('merge')}
					disabled={busy}>Merge with local data</button
				>
				<button class="btn-quiet" type="button" onclick={cancel} disabled={busy}>Cancel</button>
			</div>
		</section>
	{/if}
</div>
