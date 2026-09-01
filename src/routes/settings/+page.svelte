<script lang="ts">
	import { useAppState } from '$lib/app-state.svelte';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import BackupImporter from '$lib/components/BackupImporter.svelte';
	import type { Difficulty, ExerciseType, Theme } from '$lib/domain/types';
	import { triggerCsvDownload } from '$lib/services/backup';

	const app = useAppState();
	let resetPanel = $state(false);
	let resetConfirmed = $state(false);
	let busy = $state(false);
	let exportError = $state('');

	async function updateSelect(
		event: Event,
		field: 'theme' | 'mentalMathDifficulty' | 'patternDifficulty' | 'lastSelectedExercise'
	) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (field === 'theme') await app.updateSettings({ theme: value as Theme });
		else if (field === 'mentalMathDifficulty')
			await app.updateSettings({ mentalMathDifficulty: value as Difficulty });
		else if (field === 'patternDifficulty')
			await app.updateSettings({ patternDifficulty: value as Difficulty });
		else await app.updateSettings({ lastSelectedExercise: value as ExerciseType });
	}

	async function updateCheckbox(event: Event, field: 'soundEnabled' | 'reducedFeedbackAnimation') {
		const value = (event.currentTarget as HTMLInputElement).checked;
		await app.updateSettings({ [field]: value });
	}

	async function updateDuration(
		event: Event,
		field: 'defaultMentalMathDurationMs' | 'defaultPatternDurationMs'
	) {
		await app.updateSettings({ [field]: Number((event.currentTarget as HTMLSelectElement).value) });
	}

	async function exportBackup() {
		busy = true;
		exportError = '';
		try {
			await app.exportBackup();
		} catch (cause) {
			exportError = cause instanceof Error ? cause.message : 'Backup export failed.';
		} finally {
			busy = false;
		}
	}

	async function deleteData() {
		if (!resetConfirmed) return;
		busy = true;
		try {
			await app.resetToWelcome();
			await goto(resolve('/'));
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Settings — Think Fast</title></svelte:head>

{#if app.status !== 'ready' || !app.snapshot || !app.settings}
	<main class="mx-auto max-w-xl px-5 py-16 text-center">
		<h1 class="text-2xl font-bold">Settings are available after initialization.</h1>
		<a href={resolve('/')} class="btn-primary mt-5">Return home</a>
	</main>
{:else}
	<main class="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
		<header class="border-b border-[var(--line)] pb-7">
			<p class="eyebrow">Local controls</p>
			<h1 class="mt-2 text-4xl font-black tracking-tight">Settings</h1>
			<p class="mt-3 max-w-2xl leading-7 text-[var(--muted)]">
				Preferences save immediately to IndexedDB on this device.
			</p>
		</header>

		<section
			class="grid gap-7 border-b border-[var(--line)] py-9 md:grid-cols-[0.7fr_1.3fr]"
			aria-labelledby="appearance-title"
		>
			<div>
				<p class="eyebrow">Interface</p>
				<h2 id="appearance-title" class="mt-1 text-xl font-bold">Appearance & feedback</h2>
			</div>
			<div class="grid gap-5">
				<label class="field"
					><span>Theme</span><select
						class="input"
						value={app.settings.theme}
						onchange={(event) => updateSelect(event, 'theme')}
						><option value="system">System</option><option value="light">Light</option><option
							value="dark">Dark</option
						></select
					></label
				>
				<label class="flex items-start justify-between gap-6 border-b border-[var(--line)] py-3"
					><span
						><strong>Sound feedback</strong><span class="mt-1 block text-sm text-[var(--muted)]"
							>Permit brief local correctness tones during practice.</span
						></span
					><input
						class="mt-1 size-5"
						type="checkbox"
						checked={app.settings.soundEnabled}
						onchange={(event) => updateCheckbox(event, 'soundEnabled')}
					/></label
				>
				<label class="flex items-start justify-between gap-6 py-3"
					><span
						><strong>Reduce feedback animation</strong><span
							class="mt-1 block text-sm text-[var(--muted)]"
							>Minimize visual feedback even when system motion is allowed.</span
						></span
					><input
						class="mt-1 size-5"
						type="checkbox"
						checked={app.settings.reducedFeedbackAnimation}
						onchange={(event) => updateCheckbox(event, 'reducedFeedbackAnimation')}
					/></label
				>
			</div>
		</section>

		<section
			class="grid gap-7 border-b border-[var(--line)] py-9 md:grid-cols-[0.7fr_1.3fr]"
			aria-labelledby="defaults-title"
		>
			<div>
				<p class="eyebrow">Practice</p>
				<h2 id="defaults-title" class="mt-1 text-xl font-bold">Session defaults</h2>
			</div>
			<div class="grid gap-5 sm:grid-cols-2">
				<label class="field"
					><span>Mental-math difficulty</span><select
						class="input"
						value={app.settings.mentalMathDifficulty}
						onchange={(event) => updateSelect(event, 'mentalMathDifficulty')}
						><option value="easy">Easy</option><option value="standard">Standard</option><option
							value="hard">Hard</option
						></select
					></label
				>
				<label class="field"
					><span>Mental-math duration</span><select
						class="input"
						value={app.settings.defaultMentalMathDurationMs}
						onchange={(event) => updateDuration(event, 'defaultMentalMathDurationMs')}
						><option value={120000}>2 minutes</option><option value={240000}>4 minutes</option
						><option value={480000}>8 minutes</option><option value={720000}>12 minutes</option
						></select
					></label
				>
				<label class="field"
					><span>Pattern difficulty</span><select
						class="input"
						value={app.settings.patternDifficulty}
						onchange={(event) => updateSelect(event, 'patternDifficulty')}
						><option value="easy">Easy · 2×2</option><option value="standard">Standard · 3×3</option
						><option value="hard">Hard · 4×4</option></select
					></label
				>
				<label class="field"
					><span>Pattern duration</span><select
						class="input"
						value={app.settings.defaultPatternDurationMs}
						onchange={(event) => updateDuration(event, 'defaultPatternDurationMs')}
						><option value={60000}>1 minute</option><option value={120000}>2 minutes</option><option
							value={180000}>3 minutes</option
						><option value={300000}>5 minutes</option></select
					></label
				>
				<label class="field sm:col-span-2"
					><span>Last selected exercise</span><select
						class="input"
						value={app.settings.lastSelectedExercise}
						onchange={(event) => updateSelect(event, 'lastSelectedExercise')}
						><option value="mental-math">Mental Math</option><option value="arrow-patterns"
							>Arrow Patterns</option
						></select
					></label
				>
			</div>
		</section>

		<section
			class="grid gap-7 border-b border-[var(--line)] py-9 md:grid-cols-[0.7fr_1.3fr]"
			aria-labelledby="backup-title"
		>
			<div>
				<p class="eyebrow">Portability</p>
				<h2 id="backup-title" class="mt-1 text-xl font-bold">Backup & restore</h2>
			</div>
			<div class="grid gap-6">
				<div class="rounded-sm bg-[var(--accent-soft)] p-4 text-sm leading-6">
					<strong>Your progress is saved in this browser.</strong> Export a backup to move it to another
					browser or protect it if site data is cleared.
				</div>
				<div class="flex flex-wrap gap-2">
					<button class="btn-primary" onclick={exportBackup} disabled={busy}>Export backup</button
					><button class="btn-secondary" onclick={() => triggerCsvDownload(app.snapshot!)}
						>Export statistics CSV</button
					>
				</div>
				{#if exportError}<p class="text-sm font-semibold text-[var(--danger)]" role="alert">
						{exportError}
					</p>{/if}
				<p class="text-sm text-[var(--muted)]">
					Last successful JSON export: {app.snapshot.metadata.lastSuccessfulExportAt
						? new Date(app.snapshot.metadata.lastSuccessfulExportAt).toLocaleString()
						: 'Never'}
				</p>
				<BackupImporter label="Import backup" />
				<div class="border-l-4 border-[var(--warning)] pl-4 text-sm leading-6">
					<strong>About closing this tab</strong>
					<p class="text-[var(--muted)]">
						When unexported changes exist, the browser may show its generic leave warning. Browsers
						cannot reliably download a file after a tab closes or display custom warning text.
						IndexedDB remains the automatic source of truth.
					</p>
				</div>
			</div>
		</section>

		<section class="grid gap-7 py-9 md:grid-cols-[0.7fr_1.3fr]" aria-labelledby="reset-title">
			<div>
				<p class="eyebrow text-[var(--danger)]">Danger zone</p>
				<h2 id="reset-title" class="mt-1 text-xl font-bold">Delete all local data</h2>
			</div>
			<div>
				<p class="leading-7 text-[var(--muted)]">
					Deletes settings, every session, every attempt, and backup metadata from this browser’s
					Think Fast IndexedDB. This cannot be undone.
				</p>
				{#if !resetPanel}<button
						class="btn-danger mt-5"
						onclick={() => (resetPanel = true)}
						data-testid="open-reset">Delete all local data</button
					>{:else}<div
						class="mt-5 grid gap-4 rounded-md border border-[var(--danger)] bg-[var(--danger-soft)] p-5"
					>
						<h3 class="font-bold text-[var(--danger)]">
							Export first if you may want this data later.
						</h3>
						<button class="btn-secondary justify-self-start" onclick={exportBackup}
							>Export backup before deletion</button
						><label class="flex items-start gap-3 text-sm"
							><input class="mt-1 size-4" type="checkbox" bind:checked={resetConfirmed} /><span
								>I understand that all Think Fast data in this browser will be permanently deleted.</span
							></label
						>
						<div class="flex flex-wrap gap-2">
							<button
								class="btn-danger"
								onclick={deleteData}
								disabled={!resetConfirmed || busy}
								data-testid="confirm-reset">Permanently delete local data</button
							><button
								class="btn-quiet"
								onclick={() => {
									resetPanel = false;
									resetConfirmed = false;
								}}>Cancel</button
							>
						</div>
					</div>{/if}
			</div>
		</section>
	</main>
{/if}
