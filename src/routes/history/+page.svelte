<script lang="ts">
	import { useAppState } from '$lib/app-state.svelte';
	import { resolve } from '$app/paths';
	import MiniTrend from '$lib/components/MiniTrend.svelte';
	import { summarizeAttempts } from '$lib/domain/scoring';
	import {
		filteredHistory,
		groupAttempts,
		trendPoints,
		type HistoryFilters
	} from '$lib/domain/statistics';
	import { formatDuration } from '$lib/domain/timer';

	const app = useAppState();
	let exercise = $state<HistoryFilters['exercise']>('all');
	let category = $state('all');
	let difficulty = $state<HistoryFilters['difficulty']>('all');
	let dateRange = $state<HistoryFilters['dateRange']>('all');
	let snapshot = $derived(app.snapshot);
	let categories = $derived(
		snapshot ? [...new Set(snapshot.attempts.map((attempt) => attempt.problemCategory))].sort() : []
	);
	let filtered = $derived(
		snapshot
			? filteredHistory(snapshot, { exercise, category, difficulty, dateRange })
			: { sessions: [], attempts: [] }
	);
	let summary = $derived(summarizeAttempts(filtered.attempts));
	let activeMs = $derived(
		filtered.sessions.reduce((total, session) => total + session.activeDurationMs, 0)
	);
	let byCategory = $derived(groupAttempts(filtered.attempts, (attempt) => attempt.problemCategory));
	let trends = $derived(trendPoints(filtered.sessions));
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

	function exerciseName(value: string): string {
		return value === 'mental-math' ? 'Mental Math' : 'Arrow Patterns';
	}
</script>

<svelte:head><title>History — Think Fast</title></svelte:head>

{#if app.status !== 'ready' || !snapshot}
	<main class="mx-auto max-w-xl px-5 py-16 text-center">
		<h1 class="text-2xl font-bold">History is available after initialization.</h1>
		<a href={resolve('/')} class="btn-primary mt-5">Return home</a>
	</main>
{:else}
	<main class="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
		<header class="border-b border-[var(--line)] pb-7">
			<p class="eyebrow">Local analysis</p>
			<h1 class="mt-2 text-4xl font-black tracking-tight">History & statistics</h1>
			<p class="mt-3 max-w-2xl text-[var(--muted)]">
				Every filter and calculation runs locally. Interrupted sessions remain visible and are
				labeled.
			</p>
		</header>
		<section
			class="grid gap-4 border-b border-[var(--line)] py-6 sm:grid-cols-2 lg:grid-cols-4"
			aria-label="History filters"
		>
			<label class="field"
				><span>Exercise</span><select class="input" bind:value={exercise}
					><option value="all">All exercises</option><option value="mental-math">Mental Math</option
					><option value="arrow-patterns">Arrow Patterns</option></select
				></label
			>
			<label class="field"
				><span>Category</span><select class="input" bind:value={category}
					><option value="all">All categories</option>{#each categories as item (item)}<option
							value={item}>{item}</option
						>{/each}</select
				></label
			>
			<label class="field"
				><span>Date range</span><select class="input" bind:value={dateRange}
					><option value="all">All time</option><option value="7d">Last 7 days</option><option
						value="30d">Last 30 days</option
					><option value="90d">Last 90 days</option></select
				></label
			>
			<label class="field"
				><span>Difficulty</span><select class="input" bind:value={difficulty}
					><option value="all">All difficulties</option><option value="easy">Easy</option><option
						value="standard">Standard</option
					><option value="hard">Hard</option></select
				></label
			>
		</section>

		<section
			class="grid border-b border-[var(--line)] sm:grid-cols-2 lg:grid-cols-4"
			aria-label="Filtered summary"
		>
			<div class="py-6">
				<p class="eyebrow">Sessions</p>
				<p class="metric mt-2">{filtered.sessions.length}</p>
			</div>
			<div class="py-6">
				<p class="eyebrow">Attempts</p>
				<p class="metric mt-2">{summary.attempted}</p>
			</div>
			<div class="py-6">
				<p class="eyebrow">Accuracy</p>
				<p class="metric mt-2">{summary.accuracy.toFixed(1)}%</p>
			</div>
			<div class="py-6">
				<p class="eyebrow">Active time</p>
				<p class="metric mt-2">{formatDuration(activeMs)}</p>
			</div>
		</section>

		{#if filtered.sessions.length === 0 && filtered.attempts.length === 0}
			<section class="surface my-10 rounded-md border-dashed p-8 text-center">
				<p class="eyebrow">No matching data</p>
				<h2 class="mt-2 text-xl font-bold">
					Practice sessions matching these filters will appear here.
				</h2>
				<p class="mt-2 text-[var(--muted)]">Try a broader filter or start a new drill.</p>
			</section>
		{:else}
			<section class="grid gap-8 border-b border-[var(--line)] py-9 lg:grid-cols-2">
				<div>
					<p class="eyebrow">Sequence</p>
					<h2 class="mt-1 text-xl font-bold">Accuracy trend</h2>
					<div class="mt-4"><MiniTrend points={accuracyTrend} suffix="%" /></div>
				</div>
				<div>
					<p class="eyebrow">Sequence</p>
					<h2 class="mt-1 text-xl font-bold">Response-time trend</h2>
					<div class="mt-4"><MiniTrend points={responseTrend} suffix="s" /></div>
				</div>
			</section>
			<section class="grid gap-8 border-b border-[var(--line)] py-9 lg:grid-cols-[0.65fr_1.35fr]">
				<div>
					<p class="eyebrow">Filtered attempts</p>
					<h2 class="mt-1 text-xl font-bold">Category performance</h2>
					<div class="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">
						{#each byCategory as item (item.key)}<div class="grid grid-cols-[1fr_auto] gap-4 py-3">
								<span class="capitalize">{item.key}</span><span class="mono font-bold"
									>{item.accuracy.toFixed(1)}%</span
								>
							</div>{/each}
					</div>
					{#if filtered.attempts.some((attempt) => !snapshot.sessions.some((session) => session.id === attempt.sessionId))}<p
							class="mt-4 text-sm text-[var(--warning)]"
						>
							Orphaned attempts are included in attempt statistics but not session totals.
						</p>{/if}
				</div>
				<div>
					<p class="eyebrow">Local log</p>
					<h2 class="mt-1 text-xl font-bold">Sessions</h2>
					<div class="mt-4 overflow-x-auto">
						<table class="w-full min-w-[640px] text-left text-sm">
							<thead
								class="border-b border-[var(--line)] text-xs uppercase tracking-wider text-[var(--muted)]"
								><tr
									><th class="py-3 pr-3">Exercise</th><th class="px-3 py-3">Date</th><th
										class="px-3 py-3">Difficulty</th
									><th class="px-3 py-3">Result</th><th class="py-3 pl-3">Status</th></tr
								></thead
							><tbody class="divide-y divide-[var(--line)]"
								>{#each [...filtered.sessions].sort( (a, b) => b.startedAt.localeCompare(a.startedAt) ) as session (session.id)}<tr
										><td class="py-4 pr-3 font-semibold">{exerciseName(session.exerciseType)}</td
										><td class="px-3 py-4 text-[var(--muted)]"
											>{new Date(session.startedAt).toLocaleDateString()}</td
										><td class="px-3 py-4 capitalize">{session.difficulty}</td><td
											class="mono px-3 py-4"
											>{session.correctCount}/{session.attemptedCount} · {session.attemptedCount
												? `${((session.correctCount / session.attemptedCount) * 100).toFixed(0)}%`
												: '—'}</td
										><td class="px-3 py-4 capitalize text-[var(--muted)]"
											>{session.completionReason.replaceAll('-', ' ')}</td
										></tr
									>{/each}</tbody
							>
						</table>
					</div>
				</div>
			</section>
		{/if}
	</main>
{/if}
