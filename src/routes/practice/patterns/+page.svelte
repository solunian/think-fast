<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { useAppState } from '$lib/app-state.svelte';
	import { resolve } from '$app/paths';
	import ArrowGrid from '$lib/components/ArrowGrid.svelte';
	import {
		compactPattern,
		createBalancedPatternAnswers,
		generatePatternTrial
	} from '$lib/domain/pattern-generator';
	import { accuracy, summarizeAttempts } from '$lib/domain/scoring';
	import { groupAttempts, recentComparison } from '$lib/domain/statistics';
	import { ActiveTimer, formatDuration } from '$lib/domain/timer';
	import { playFeedbackTone } from '$lib/services/sound';
	import type {
		ArrowDirection,
		AttemptRecord,
		CompletionReason,
		Difficulty,
		PatternTrial,
		SessionRecord
	} from '$lib/domain/types';

	type Phase = 'config' | 'countdown' | 'active' | 'results';
	const app = useAppState();
	let phase = $state<Phase>('config');
	let difficulty = $derived<Difficulty>(app.settings?.patternDifficulty ?? 'standard');
	let durationMs = $derived(app.settings?.defaultPatternDurationMs ?? 2 * 60 * 1000);
	let countdownRemaining = $state(3000);
	let remainingMs = $state(0);
	let paused = $state(false);
	let announcement = $state('');
	let feedback = $state<'correct' | 'incorrect' | ''>('');
	let trial = $state.raw<PatternTrial | null>(null);
	let sessionAttempts = $state.raw<AttemptRecord[]>([]);
	let resultSession = $state.raw<SessionRecord | null>(null);
	let sessionId = '';
	let sessionStartedAt = '';
	let sessionTimer: ActiveTimer | null = null;
	let countdownTimer: ActiveTimer | null = null;
	let responseTimer: ActiveTimer | null = null;
	let animationFrame = 0;
	let answerDeck: boolean[] = [];
	let answerIndex = 0;
	let finalized = false;
	let submitting = $state(false);
	let feedbackTimer: ReturnType<typeof setTimeout> | null = null;
	let summary = $derived(summarizeAttempts(sessionAttempts));
	let currentAccuracy = $derived(accuracy(summary.correct, summary.attempted));
	let breakdown = $derived(groupAttempts(sessionAttempts, (attempt) => attempt.problemCategory));
	let comparison = $derived(
		resultSession && app.snapshot ? recentComparison(resultSession, app.snapshot.sessions) : null
	);
	let missedReviews = $derived.by(() =>
		sessionAttempts
			.filter((attempt) => !attempt.correct)
			.map((attempt) => {
				const metadata = attempt.metadata ?? {};
				return {
					attempt,
					trial: {
						left: (metadata.left ?? []) as ArrowDirection[],
						right: (metadata.right ?? []) as ArrowDirection[],
						size: (metadata.size ?? 2) as 2 | 3 | 4,
						isSame: Boolean(metadata.isSame),
						mismatchIndices: (metadata.mismatchIndices ?? []) as number[],
						signature: attempt.prompt
					} satisfies PatternTrial
				};
			})
	);

	function provisionalSession(startedAt: string): SessionRecord {
		return {
			id: sessionId,
			exerciseType: 'arrow-patterns',
			category: 'same-or-different',
			startedAt,
			endedAt: startedAt,
			activeDurationMs: 0,
			configuredDurationMs: durationMs,
			attemptedCount: 0,
			correctCount: 0,
			incorrectCount: 0,
			skippedCount: 0,
			averageResponseMs: 0,
			medianResponseMs: 0,
			completionReason: 'interrupted',
			difficulty,
			configuration: {
				gridSize: difficulty === 'easy' ? 2 : difficulty === 'standard' ? 3 : 4,
				hiddenTabPolicy: 'pause'
			}
		};
	}

	async function startSession() {
		if (app.status !== 'ready') return;
		await app.updateSettings({
			patternDifficulty: difficulty,
			defaultPatternDurationMs: durationMs,
			lastSelectedExercise: 'arrow-patterns'
		});
		sessionId = crypto.randomUUID();
		sessionStartedAt = new Date().toISOString();
		sessionAttempts = [];
		resultSession = null;
		finalized = false;
		answerDeck = createBalancedPatternAnswers(Math.random);
		answerIndex = 0;
		await app.beginSession(provisionalSession(sessionStartedAt));
		phase = 'countdown';
		countdownTimer = new ActiveTimer(3000);
		countdownTimer.start();
		countdownRemaining = 3000;
		announcement = 'Session begins in 3 seconds.';
	}

	function beginActivePhase() {
		if (phase !== 'countdown') return;
		phase = 'active';
		sessionTimer = new ActiveTimer(durationMs);
		sessionTimer.start();
		remainingMs = durationMs;
		showNextTrial();
		announcement = 'Session started. Decide same or different.';
	}

	function nextAnswer(): boolean {
		if (answerIndex >= answerDeck.length) {
			answerDeck = createBalancedPatternAnswers(Math.random);
			answerIndex = 0;
		}
		const answer = answerDeck[answerIndex];
		answerIndex += 1;
		return answer;
	}

	function showNextTrial() {
		trial = generatePatternTrial(Math.random, difficulty, nextAnswer());
		responseTimer = new ActiveTimer(60 * 60 * 1000);
		responseTimer.start();
	}

	async function respond(selectedSame: boolean) {
		if (phase !== 'active' || paused || submitting || !trial || !responseTimer) return;
		submitting = true;
		const current = trial;
		const attempt: AttemptRecord = {
			id: crypto.randomUUID(),
			sessionId,
			exerciseType: 'arrow-patterns',
			problemCategory: current.isSame ? 'same' : 'different',
			prompt: compactPattern(current),
			submittedAnswer: selectedSame ? 'same' : 'different',
			expectedAnswer: current.isSame ? 'same' : 'different',
			correct: selectedSame === current.isSame,
			responseTimeMs: responseTimer.stop(),
			difficulty,
			timestamp: new Date().toISOString(),
			metadata: {
				left: current.left,
				right: current.right,
				size: current.size,
				isSame: current.isSame,
				mismatchIndices: current.mismatchIndices
			}
		};
		try {
			const nextAttempts = [...sessionAttempts, attempt];
			const checkpointSummary = summarizeAttempts(nextAttempts);
			const checkpoint: SessionRecord = {
				...provisionalSession(sessionStartedAt),
				endedAt: attempt.timestamp,
				activeDurationMs: sessionTimer?.elapsedMs() ?? 0,
				attemptedCount: checkpointSummary.attempted,
				correctCount: checkpointSummary.correct,
				incorrectCount: checkpointSummary.incorrect,
				averageResponseMs: checkpointSummary.averageResponseMs,
				medianResponseMs: checkpointSummary.medianResponseMs
			};
			await app.addAttempt(attempt, checkpoint);
			sessionAttempts = nextAttempts;
			playFeedbackTone(app.settings?.soundEnabled ?? false, attempt.correct);
			feedback = attempt.correct ? 'correct' : 'incorrect';
			if (feedbackTimer) clearTimeout(feedbackTimer);
			feedbackTimer = setTimeout(() => (feedback = ''), 350);
			showNextTrial();
		} finally {
			submitting = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (phase !== 'active' || paused || submitting) return;
		const key = event.key.toLowerCase();
		if (key === 'arrowleft' || key === 'd') {
			event.preventDefault();
			void respond(false);
		} else if (key === 'arrowright' || key === 's') {
			event.preventDefault();
			void respond(true);
		}
	}

	async function endSession(reason: CompletionReason) {
		if (finalized || !sessionTimer) return;
		finalized = true;
		const activeDurationMs = sessionTimer.stop();
		responseTimer?.pause();
		const results = summarizeAttempts(sessionAttempts);
		const session: SessionRecord = {
			...provisionalSession(sessionStartedAt),
			endedAt: new Date().toISOString(),
			activeDurationMs,
			attemptedCount: results.attempted,
			correctCount: results.correct,
			incorrectCount: results.incorrect,
			skippedCount: reason === 'timer-expired' && trial ? 1 : 0,
			averageResponseMs: results.averageResponseMs,
			medianResponseMs: results.medianResponseMs,
			completionReason: reason
		};
		await app.finishSession(session);
		resultSession = session;
		phase = 'results';
		announcement = `Session complete. ${results.correct} correct of ${results.attempted}.`;
	}

	function requestEnd() {
		if (confirm('End this session now? Your completed attempts will be saved.'))
			void endSession('user-ended');
	}

	function handleVisibilityChange() {
		if (document.hidden && (phase === 'active' || phase === 'countdown')) {
			paused = true;
			countdownTimer?.pause();
			sessionTimer?.pause();
			responseTimer?.pause();
			announcement = 'Session paused because this tab is hidden.';
		} else if (!document.hidden && paused) {
			paused = false;
			countdownTimer?.resume();
			sessionTimer?.resume();
			responseTimer?.resume();
			announcement = 'Session resumed.';
		}
	}

	function frame() {
		if (phase === 'countdown' && countdownTimer) {
			countdownRemaining = countdownTimer.remainingMs();
			if (countdownTimer.isExpired()) beginActivePhase();
		} else if (phase === 'active' && sessionTimer) {
			remainingMs = sessionTimer.remainingMs();
			if (sessionTimer.isExpired()) void endSession('timer-expired');
		}
		animationFrame = requestAnimationFrame(frame);
	}

	function resetPractice() {
		phase = 'config';
		trial = null;
		sessionAttempts = [];
		resultSession = null;
	}

	onMount(() => {
		animationFrame = requestAnimationFrame(frame);
	});
	onDestroy(() => {
		cancelAnimationFrame(animationFrame);
		if (feedbackTimer) clearTimeout(feedbackTimer);
		if (!finalized && phase === 'active' && sessionTimer) void endSession('interrupted');
	});
</script>

<svelte:window onkeydown={handleKeydown} />
<svelte:document onvisibilitychange={handleVisibilityChange} />
<svelte:head><title>Arrow Patterns — Think Fast</title></svelte:head>
<p class="sr-only" aria-live="polite">{announcement}</p>

{#if app.status !== 'ready'}
	<main class="mx-auto grid min-h-screen max-w-xl place-items-center px-5 text-center">
		<div>
			<h1 class="text-2xl font-bold">Local data is not ready.</h1>
			<a class="btn-primary mt-5" href={resolve('/')}>Return to initialization</a>
		</div>
	</main>
{:else if phase === 'config'}
	<main class="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-16">
		<a
			href={resolve('/')}
			class="text-sm font-bold text-[var(--muted)] no-underline hover:text-[var(--ink)]"
			>← Dashboard</a
		>
		<div class="mt-10 grid gap-10 md:grid-cols-[1.15fr_0.85fr]">
			<section>
				<p class="eyebrow">Arrow patterns</p>
				<h1 class="mt-3 text-5xl font-black tracking-[-0.05em]">Detect the mismatch.</h1>
				<p class="mt-5 max-w-xl text-lg leading-8 text-[var(--muted)]">
					Compare every position in two arrow grids. Respond immediately when all directions
					match—or when any one differs.
				</p>
				<div class="mt-8 grid gap-2 border-y border-[var(--line)] py-5 text-sm">
					<p>
						<kbd class="mono rounded-sm border border-[var(--line)] px-2 py-1">←</kbd> or
						<kbd class="mono rounded-sm border border-[var(--line)] px-2 py-1">D</kbd>
						<strong class="ml-2">Different</strong>
					</p>
					<p>
						<kbd class="mono rounded-sm border border-[var(--line)] px-2 py-1">→</kbd> or
						<kbd class="mono rounded-sm border border-[var(--line)] px-2 py-1">S</kbd>
						<strong class="ml-2">Same</strong>
					</p>
				</div>
			</section>
			<form
				class="surface grid gap-5 rounded-md p-6"
				onsubmit={(event) => {
					event.preventDefault();
					void startSession();
				}}
			>
				<label class="field"
					><span>Difficulty and grid size</span><select class="input" bind:value={difficulty}
						><option value="easy">Easy · 2×2</option><option value="standard">Standard · 3×3</option
						><option value="hard">Hard · 4×4</option></select
					></label
				>
				<label class="field"
					><span>Duration</span><select class="input" bind:value={durationMs}
						><option value={60000}>1 minute</option><option value={120000}>2 minutes</option><option
							value={180000}>3 minutes</option
						><option value={300000}>5 minutes</option></select
					></label
				>
				<div class="rounded-sm bg-[var(--surface-muted)] p-4 text-sm leading-6">
					<strong>Trials are balanced.</strong>
					<p class="text-[var(--muted)]">
						Half match and half differ within each local sequence. Hidden tabs pause all timing.
					</p>
				</div>
				<button class="btn-primary" type="submit" data-testid="start-patterns"
					>Begin 3–2–1 countdown</button
				>
			</form>
		</div>
	</main>
{:else if phase === 'countdown'}
	<main class="grid min-h-screen place-items-center px-5 text-center">
		<div>
			<p class="eyebrow">Get ready</p>
			<p
				class="mono mt-5 text-[clamp(7rem,28vw,16rem)] font-black leading-none text-[var(--accent)]"
			>
				{Math.max(1, Math.ceil(countdownRemaining / 1000))}
			</p>
			<p class="mt-6 text-[var(--muted)]">Different: ← / D · Same: → / S</p>
			{#if paused}<p class="mt-3 font-bold text-[var(--warning)]" role="status">
					Paused — return to this tab to continue
				</p>{/if}
		</div>
	</main>
{:else if phase === 'active' && trial}
	<main class="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-5 sm:px-8 sm:py-8">
		<header class="grid grid-cols-3 items-center border-b border-[var(--line)] pb-4 text-sm">
			<div>
				<span class="eyebrow">Trials</span>
				<p class="mono mt-1 font-bold">{summary.attempted}</p>
			</div>
			<div class="text-center">
				<span class="eyebrow">Remaining</span>
				<p class="mono mt-1 text-2xl font-black" data-testid="pattern-timer">
					{formatDuration(remainingMs)}
				</p>
			</div>
			<div class="text-right">
				<span class="eyebrow">Accuracy</span>
				<p class="mono mt-1 font-bold">
					{summary.attempted ? `${currentAccuracy.toFixed(0)}%` : '—'}
				</p>
			</div>
		</header>
		<div class="mt-3 h-1 bg-[var(--surface-muted)]" aria-hidden="true">
			<div
				class="h-full bg-[var(--accent)]"
				style:width={`${(1 - remainingMs / durationMs) * 100}%`}
			></div>
		</div>
		<section class="grid flex-1 content-center py-7 text-center" aria-labelledby="pattern-question">
			<p class="eyebrow">Compare every position</p>
			<h1 id="pattern-question" class="mt-2 text-2xl font-black">Same or different?</h1>
			<div class="mx-auto mt-7 grid w-full max-w-4xl grid-cols-2 gap-3 sm:gap-8">
				<ArrowGrid directions={trial.left} size={trial.size} label="Left arrow grid" /><ArrowGrid
					directions={trial.right}
					size={trial.size}
					label="Right arrow grid"
				/>
			</div>
			<p
				class={[
					'mt-4 min-h-6 text-sm font-bold',
					feedback === 'correct'
						? 'text-[var(--success)]'
						: feedback === 'incorrect'
							? 'text-[var(--danger)]'
							: ''
				]}
				aria-live="polite"
			>
				{feedback === 'correct' ? 'Correct' : feedback === 'incorrect' ? 'Incorrect' : ''}
			</p>
		</section>
		<div class="mx-auto grid w-full max-w-3xl grid-cols-2 gap-3">
			<button
				class="btn-secondary min-h-16 text-lg"
				onclick={() => respond(false)}
				disabled={submitting || paused}
				data-testid="different-button"
				><span class="mono" aria-hidden="true">← / D</span> Different</button
			><button
				class="btn-primary min-h-16 text-lg"
				onclick={() => respond(true)}
				disabled={submitting || paused}
				data-testid="same-button">Same <span class="mono" aria-hidden="true">→ / S</span></button
			>
		</div>
		<footer
			class="mt-5 flex items-center justify-between border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]"
		>
			<span>Keyboard and touch controls enabled</span><button
				class="btn-quiet min-h-0 px-2 py-2"
				onclick={requestEnd}>End session</button
			>
		</footer>
		{#if paused}<div
				class="fixed inset-0 grid place-items-center bg-[var(--bg)]/95 p-5 text-center"
			>
				<div>
					<p class="eyebrow">Session paused</p>
					<h2 class="mt-2 text-3xl font-black">Return focus to continue</h2>
					<p class="mt-3 text-[var(--muted)]">
						Hidden time is excluded from your practice and reaction time.
					</p>
				</div>
			</div>{/if}
	</main>
{:else if phase === 'results' && resultSession}
	<main class="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
		<header
			class="flex flex-col justify-between gap-5 border-b border-[var(--line)] pb-7 sm:flex-row sm:items-end"
		>
			<div>
				<p class="eyebrow">Session results</p>
				<h1 class="mt-2 text-4xl font-black tracking-tight">
					{summary.accuracy.toFixed(1)}% accurate
				</h1>
				<p class="mt-2 text-[var(--muted)]">
					{resultSession.completionReason.replaceAll('-', ' ')} · saved locally
				</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<button class="btn-secondary" onclick={() => app.exportBackup()}>Export backup</button
				><button class="btn-primary" onclick={resetPractice}>Practice again</button>
			</div>
		</header>
		<section class="grid border-b border-[var(--line)] sm:grid-cols-2 lg:grid-cols-4">
			<div class="py-6">
				<p class="eyebrow">Attempted</p>
				<p class="metric mt-2">{summary.attempted}</p>
			</div>
			<div class="py-6">
				<p class="eyebrow">Correct</p>
				<p class="metric mt-2">{summary.correct}</p>
			</div>
			<div class="py-6">
				<p class="eyebrow">Avg / median reaction</p>
				<p class="mono mt-2 text-xl font-bold">
					{(summary.averageResponseMs / 1000).toFixed(2)}s / {(
						summary.medianResponseMs / 1000
					).toFixed(2)}s
				</p>
			</div>
			<div class="py-6">
				<p class="eyebrow">Active time</p>
				<p class="mono mt-2 text-xl font-bold">{formatDuration(resultSession.activeDurationMs)}</p>
			</div>
		</section>
		{#if comparison}<section class="mt-8 border-l-4 border-[var(--accent)] pl-4">
				<p class="eyebrow">Compared with last {comparison.sampleSize}</p>
				<p class="mt-2 font-semibold">
					Accuracy {comparison.accuracyDelta >= 0 ? '+' : ''}{comparison.accuracyDelta.toFixed(1)} points
					· reaction time {comparison.responseDeltaMs <= 0 ? 'faster by' : 'slower by'}
					{Math.abs(comparison.responseDeltaMs / 1000).toFixed(2)}s
				</p>
			</section>{/if}
		<section class="mt-10 grid gap-10 lg:grid-cols-2">
			<div>
				<p class="eyebrow">Breakdown</p>
				<h2 class="mt-1 text-xl font-bold">Same versus different</h2>
				<div class="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">
					{#each breakdown as item (item.key)}<div
							class="grid grid-cols-[1fr_auto_auto] gap-5 py-3"
						>
							<span class="capitalize">{item.key}</span><span class="mono text-[var(--muted)]"
								>{item.correct}/{item.attempted}</span
							><strong class="mono">{item.accuracy.toFixed(0)}%</strong>
						</div>{/each}
				</div>
			</div>
			<div>
				<p class="eyebrow">Review</p>
				<h2 class="mt-1 text-xl font-bold">Missed patterns</h2>
				{#if missedReviews.length}<div class="mt-4 grid gap-4">
						{#each missedReviews as review (review.attempt.id)}<article
								class="surface rounded-md p-3"
							>
								<div class="grid grid-cols-2 gap-2">
									<ArrowGrid
										directions={review.trial.left}
										size={review.trial.size}
										label="Reviewed left grid"
										compact
									/><ArrowGrid
										directions={review.trial.right}
										size={review.trial.size}
										label="Reviewed right grid"
										compact
									/>
								</div>
								<p class="mt-3 text-sm">
									You chose <strong>{review.attempt.submittedAnswer}</strong>; expected
									<strong>{review.attempt.expectedAnswer}</strong>.
								</p>
							</article>{/each}
					</div>{:else}<p class="mt-4 font-semibold text-[var(--success)]">
						No missed patterns in this session.
					</p>{/if}
			</div>
		</section>
		<a href={resolve('/')} class="btn-quiet mt-10">← Return to dashboard</a>
	</main>
{/if}
