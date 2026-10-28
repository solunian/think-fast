<script lang="ts">
	import { useAppState } from '#lib/app-state.svelte.js';
	import { resolve } from '$app/paths';
	import BackupImporter from '#lib/components/BackupImporter.svelte';
	import MiniTrend from '#lib/components/MiniTrend.svelte';
	import { dashboardSummary, groupAttempts, trendPoints } from '#lib/domain/statistics.js';
	import { formatDuration } from '#lib/domain/timer.js';
	import { triggerRawRecoveryDownload } from '#lib/services/backup.js';

	const app = useAppState();
	let starting = $state(false);
	let resetConfirmed = $state(false);
	let snapshot = $derived(app.snapshot);
	let summary = $derived(snapshot ? dashboardSummary(snapshot) : null);
	let recent = $derived(
		snapshot
			? [...snapshot.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 6)
			: []
	);
	let exercisePerformance = $derived(
		snapshot ? groupAttempts(snapshot.attempts, (attempt) => attempt.exerciseType) : []
	);
	let mathCategories = $derived(
		snapshot
			? groupAttempts(
					snapshot.attempts.filter((attempt) => attempt.exerciseType === 'mental-math'),
					(attempt) => attempt.problemCategory
				)
			: []
	);
	let trends = $derived(snapshot ? trendPoints(snapshot.sessions) : []);
	let accuracyTrend = $derived(
		trends.map((point) => ({
			id: point.id,
			value: Math.round(point.accuracy),
			label: new Date(point.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
		}))
	);
	let responseTrend = $derived(
		trends.map((point) => ({
			id: point.id,
			value: Math.round(point.averageResponseMs / 100) / 10,
			label: new Date(point.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
		}))
	);

	async function startFresh() {
		starting = true;
		try {
			await app.startFresh();
		} finally {
			starting = false;
		}
	}

	async function resetCorruptData() {
		if (!resetConfirmed) return;
		await app.resetToWelcome();
		resetConfirmed = false;
	}

	function exerciseName(value: string): string {
		return value === 'mental-math' ? 'Mental Math' : 'Arrow Patterns';
	}
</script>

{#if app.status === 'loading'}
	<main class="mx-auto grid min-h-[75vh] max-w-xl place-items-center px-6 text-center">
		<div>
			<p class="eyebrow">Local initialization</p>
			<h1 class="mt-3 text-3xl font-semibold tracking-tight">Opening your training data</h1>
			<p class="mt-3 text-[var(--muted)]" role="status">Checking this browser’s IndexedDB…</p>
		</div>
	</main>
{:else if app.status === 'empty'}
	<main class="mx-auto grid min-h-screen max-w-5xl items-center px-5 py-12 sm:px-8">
		<div class="grid items-start gap-12 md:grid-cols-[1.15fr_0.85fr]">
			<section aria-labelledby="welcome-title">
				<p class="eyebrow">Private speed training</p>
				<h1
					id="welcome-title"
					class="mt-4 max-w-xl text-5xl font-semibold tracking-[-0.025em] sm:text-6xl"
				>
					Think clearly.<br />Respond quickly.
				</h1>

				<p class="mt-6 max-w-xl text-lg leading-8 text-[var(--muted)]">
					Train rapid mental arithmetic and visual pattern recognition. There are no accounts and
					nothing is sent anywhere.
				</p>
				<div class="mt-8 border-l-4 border-[var(--accent)] pl-4 text-sm leading-6">
					<strong>Your progress stays on this device.</strong>
					<p class="text-[var(--muted)]">
						Export a JSON backup to move it to another browser or protect it if site data is
						cleared.
					</p>
				</div>
			</section>
			<section class="surface grid gap-5 rounded-lg p-6 sm:p-8" aria-labelledby="begin-title">
				<div>
					<p class="eyebrow">Initialize</p>
					<h2 id="begin-title" class="mt-2 text-2xl font-medium">Choose where to begin</h2>
				</div>
				<BackupImporter />
				<div class="flex items-center gap-3 text-xs text-[var(--muted)]" aria-hidden="true">
					<span class="h-px flex-1 bg-[var(--line)]"></span><span>or</span><span
						class="h-px flex-1 bg-[var(--line)]"
					></span>
				</div>
				<button
					class="btn-primary w-full"
					onclick={startFresh}
					disabled={starting}
					data-testid="start-fresh">{starting ? 'Creating local workspace…' : 'Start fresh'}</button
				>
			</section>
		</div>
	</main>
{:else if app.status === 'corrupt'}
	<main class="mx-auto max-w-3xl px-5 py-16 sm:px-8">
		<section class="surface grid gap-6 rounded-lg border-t-4 border-t-[var(--danger)] p-6 sm:p-8">
			<div>
				<p class="eyebrow text-[var(--danger)]">Recovery required</p>
				<h1 class="mt-2 text-3xl font-semibold tracking-tight">Your local data needs attention</h1>
				<p class="mt-3 leading-7 text-[var(--muted)]">
					Think Fast found local data but could not validate it. Nothing has been deleted.
				</p>
				<p
					class="mt-3 rounded-sm bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]"
					role="alert"
				>
					{app.recoveryMessage}
				</p>
			</div>
			<div class="grid gap-3 sm:grid-cols-2">
				<button class="btn-secondary" onclick={() => triggerRawRecoveryDownload(app.recoveryRaw)}
					>Export recoverable raw data</button
				><BackupImporter label="Import a valid backup" />
			</div>
			<div class="border-t border-[var(--line)] pt-5">
				<label class="flex items-start gap-3 text-sm"
					><input class="mt-1 size-4" type="checkbox" bind:checked={resetConfirmed} /><span
						>I understand reset will permanently delete the unreadable local database.</span
					></label
				><button class="btn-danger mt-4" onclick={resetCorruptData} disabled={!resetConfirmed}
					>Reset local data</button
				>
			</div>
		</section>
	</main>
{:else if snapshot && summary}
	<main class="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
		<header
			class="flex flex-col justify-between gap-5 border-b border-[var(--line)] pb-7 sm:flex-row sm:items-end"
		>
			<div>
				<p class="eyebrow">Practice console</p>
				<h1 class="mt-2 text-4xl font-semibold tracking-[-0.025em]">
					Build speed without losing precision.
				</h1>
				<p class="mt-3 max-w-2xl text-[var(--muted)]">
					All calculations and progress remain in this browser.
				</p>
			</div>

			<a class="btn-secondary shrink-0" href={resolve('history')}>Open history</a>
		</header>

		<section
			class="grid gap-px overflow-hidden border-b border-[var(--line)] bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-4"
			aria-label="Overview"
		>
			<div class="bg-[var(--bg)] py-6 sm:px-5">
				<p class="eyebrow">Active time</p>
				<p class="metric mt-2">{formatDuration(summary.totalPracticeMs)}</p>
			</div>
			<div class="bg-[var(--bg)] py-6 sm:px-5">
				<p class="eyebrow">Accuracy</p>
				<p class="metric mt-2">{summary.overallAccuracy.toFixed(1)}%</p>
			</div>
			<div class="bg-[var(--bg)] py-6 sm:px-5">
				<p class="eyebrow">Completed</p>
				<p class="metric mt-2">{summary.completedSessions}</p>
			</div>
			<div class="bg-[var(--bg)] py-6 sm:px-5">
				<p class="eyebrow">Practice streak</p>
				<p class="metric mt-2">
					{summary.streak}<span class="ml-1 text-base tracking-normal">days</span>
				</p>
			</div>
		</section>

		<section class="py-9" aria-labelledby="start-title">
			<div>
				<p class="eyebrow">Choose a drill</p>
				<h2 id="start-title" class="mt-1 text-2xl font-medium">Start practice</h2>
			</div>
			<div class="mt-5 grid gap-4 md:grid-cols-2">
				<a
					href={resolve('practice/math')}
					class="surface group grid min-h-52 content-between rounded-md p-6 text-[var(--ink)] no-underline hover:border-[var(--accent)]"
					><div>
						<div class="mono text-sm font-medium text-[var(--accent)]">01 / Arithmetic</div>
						<h3 class="mt-5 text-3xl font-semibold tracking-tight">Rapid Mental Math</h3>
						<p class="mt-3 max-w-md leading-6 text-[var(--muted)]">
							Exact arithmetic under an 8-minute clock. Reach 80 questions or use the full time.
						</p>
					</div>
					<span class="mt-6 font-medium text-[var(--accent)]">Configure session →</span></a
				>
				<a
					href={resolve('practice/patterns')}
					class="surface group grid min-h-52 content-between rounded-md p-6 text-[var(--ink)] no-underline hover:border-[var(--accent)]"
					><div>
						<div class="mono text-sm font-medium text-[var(--accent)]">02 / Perception</div>
						<h3 class="mt-5 text-3xl font-semibold tracking-tight">Arrow Patterns</h3>
						<p class="mt-3 max-w-md leading-6 text-[var(--muted)]">
							Decide whether directional grids match. Two minutes, keyboard-first.
						</p>
					</div>
					<span class="mt-6 font-medium text-[var(--accent)]">Configure session →</span></a
				>
			</div>
		</section>

		{#if summary.attemptCount === 0}
			<section
				class="surface rounded-md border-dashed p-8 text-center"
				aria-labelledby="empty-stats"
			>
				<p class="eyebrow">No performance data yet</p>
				<h2 id="empty-stats" class="mt-2 text-xl font-medium">
					Your measurements begin with the first answer.
				</h2>
				<p class="mx-auto mt-2 max-w-xl text-[var(--muted)]">
					After practicing, this area will show response-time and accuracy trends, category
					performance, and recent sessions.
				</p>
			</section>
		{:else}
			<section
				class="grid gap-8 border-t border-[var(--line)] py-9 lg:grid-cols-2"
				aria-labelledby="trends-title"
			>
				<div>
					<p class="eyebrow">Recent sessions</p>
					<h2 id="trends-title" class="mt-1 text-xl font-medium">Accuracy trend</h2>
					<div class="mt-4"><MiniTrend points={accuracyTrend} suffix="%" /></div>
				</div>
				<div>
					<p class="eyebrow">Recent sessions</p>
					<h2 class="mt-1 text-xl font-medium">Average response time</h2>
					<div class="mt-4"><MiniTrend points={responseTrend} suffix="s" /></div>
				</div>
			</section>
			<section class="grid gap-8 border-t border-[var(--line)] py-9 lg:grid-cols-2">
				<div>
					<p class="eyebrow">Performance</p>
					<h2 class="mt-1 text-xl font-medium">By exercise</h2>
					<div class="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">
						{#each exercisePerformance as item (item.key)}<div
								class="grid grid-cols-[1fr_auto_auto] items-center gap-5 py-3"
							>
								<span class="font-semibold">{exerciseName(item.key)}</span><span
									class="mono text-sm text-[var(--muted)]">{item.attempted} attempts</span
								><span class="mono font-medium">{item.accuracy.toFixed(1)}%</span>
							</div>{/each}
					</div>
				</div>
				<div>
					<p class="eyebrow">Arithmetic</p>
					<h2 class="mt-1 text-xl font-medium">By category</h2>
					{#if mathCategories.length}<div
							class="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]"
						>
							{#each mathCategories as item (item.key)}<div
									class="grid grid-cols-[1fr_auto] items-center gap-5 py-3"
								>
									<span class="font-semibold capitalize">{item.key}</span><span
										class="mono font-medium">{item.accuracy.toFixed(1)}%</span
									>
								</div>{/each}
						</div>{:else}<p class="mt-4 text-sm text-[var(--muted)]">
							Complete a mental-math answer to see category detail.
						</p>{/if}
				</div>
			</section>
		{/if}

		<section class="border-t border-[var(--line)] py-9" aria-labelledby="recent-title">
			<div class="flex items-end justify-between">
				<div>
					<p class="eyebrow">Local log</p>
					<h2 id="recent-title" class="mt-1 text-xl font-medium">Recent sessions</h2>
				</div>

				<a class="text-sm font-medium text-[var(--accent)]" href={resolve('history')}>View all</a>
			</div>
			{#if recent.length}<div class="mt-4 overflow-x-auto">
					<table class="w-full min-w-[640px] text-left text-sm">
						<thead
							class="border-b border-[var(--line)] text-xs font-medium tracking-normal text-[var(--muted)]"
						>
							<tr>
								<th class="py-3 pr-4">Session</th>
								<th class="px-4 py-3">Date</th>
								<th class="px-4 py-3">Attempts</th>
								<th class="px-4 py-3">Accuracy</th>
								<th class="py-3 pl-4">Status</th>
							</tr>
						</thead>

						<tbody class="divide-y divide-[var(--line)]">
							{#each recent as session (session.id)}
								<tr>
									<td class="py-4 pr-4 font-semibold">{exerciseName(session.exerciseType)}</td>
									<td class="px-4 py-4 text-[var(--muted)]"
										>{new Date(session.startedAt).toLocaleString([], {
											dateStyle: 'medium',
											timeStyle: 'short'
										})}</td
									>
									<td class="mono px-4 py-4">{session.attemptedCount}</td>

									<td class="mono px-4 py-4">
										{session.attemptedCount
											? `${((session.correctCount / session.attemptedCount) * 100).toFixed(1)}%`
											: '—'}
									</td>

									<td class="px-4 py-4 capitalize text-[var(--muted)]"
										>{session.completionReason.replaceAll('-', ' ')}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>{:else}<p class="mt-4 text-[var(--muted)]">
					Completed and interrupted sessions will appear here.
				</p>{/if}
		</section>
	</main>
{/if}
