<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { useAppState } from '$lib/app-state.svelte';
	import { generateMathQuestion } from '$lib/domain/math-generator';
	import { groupAttempts, recentComparison } from '$lib/domain/statistics';
	import { accuracy, summarizeAttempts } from '$lib/domain/scoring';
	import { ActiveTimer, formatDuration } from '$lib/domain/timer';
	import { playFeedbackTone } from '$lib/services/sound';
	import type {
		AttemptRecord,
		CompletionReason,
		Difficulty,
		MathQuestion,
		MentalMathCategory,
		SessionRecord
	} from '$lib/domain/types';

	type Phase = 'config' | 'countdown' | 'active' | 'results';
	const app = useAppState();
	let phase = $state<Phase>('config');
	let difficulty = $derived<Difficulty>(app.settings?.mentalMathDifficulty ?? 'standard');
	let durationMs = $derived(app.settings?.defaultMentalMathDurationMs ?? 8 * 60 * 1000);
	let category = $state<MentalMathCategory>('mixed');
	let answer = $state('');
	let answerError = $state('');
	let feedback = $state<'correct' | 'incorrect' | ''>('');
	let paused = $state(false);
	let announcement = $state('');
	let countdownRemaining = $state(3000);
	let remainingMs = $state(0);
	let currentQuestion = $state.raw<MathQuestion | null>(null);
	let sessionAttempts = $state.raw<AttemptRecord[]>([]);
	let resultSession = $state.raw<SessionRecord | null>(null);
	let sessionId = '';
	let sessionStartedAt = '';
	let sessionTimer: ActiveTimer | null = null;
	let countdownTimer: ActiveTimer | null = null;
	let responseTimer: ActiveTimer | null = null;
	let answerInput = $state<HTMLInputElement>();
	let submitting = $state(false);
	let finalized = false;
	let animationFrame = 0;
	let feedbackTimer: ReturnType<typeof setTimeout> | null = null;
	let summary = $derived(summarizeAttempts(sessionAttempts));
	let currentAccuracy = $derived(accuracy(summary.correct, summary.attempted));
	let breakdown = $derived(groupAttempts(sessionAttempts, (attempt) => attempt.problemCategory));
	let incorrectAttempts = $derived(sessionAttempts.filter((attempt) => !attempt.correct));
	let comparison = $derived(
		resultSession && app.snapshot ? recentComparison(resultSession, app.snapshot.sessions) : null
	);

	function provisionalSession(startedAt: string): SessionRecord {
		return {
			id: sessionId,
			exerciseType: 'mental-math',
			category,
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
			configuration: { targetQuestions: 80, category, hiddenTabPolicy: 'pause' }
		};
	}

	async function startSession() {
		if (app.status !== 'ready') return;
		await app.updateSettings({
			mentalMathDifficulty: difficulty,
			defaultMentalMathDurationMs: durationMs,
			lastSelectedExercise: 'mental-math'
		});
		sessionId = crypto.randomUUID();
		sessionStartedAt = new Date().toISOString();
		sessionAttempts = [];
		resultSession = null;
		finalized = false;
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
		showNextQuestion();
		announcement = 'Session started.';
	}

	function showNextQuestion() {
		const previous = currentQuestion?.signature;
		currentQuestion = generateMathQuestion(Math.random, difficulty, category, previous);
		answer = '';
		answerError = '';
		responseTimer = new ActiveTimer(60 * 60 * 1000);
		responseTimer.start();
		void tick().then(() => answerInput?.focus());
	}

	async function submitAnswer(event: SubmitEvent) {
		event.preventDefault();
		if (phase !== 'active' || submitting || !currentQuestion || !responseTimer) return;
		if (!/^-?\d+$/.test(answer.trim())) {
			answerError = 'Enter a whole-number answer.';
			answerInput?.focus();
			return;
		}

		submitting = true;
		const submitted = Number.parseInt(answer, 10);
		const question = currentQuestion;
		const attempt: AttemptRecord = {
			id: crypto.randomUUID(),
			sessionId,
			exerciseType: 'mental-math',
			problemCategory: question.category,
			prompt: question.prompt,
			submittedAnswer: submitted,
			expectedAnswer: question.expectedAnswer,
			correct: submitted === question.expectedAnswer,
			responseTimeMs: responseTimer.stop(),
			difficulty,
			timestamp: new Date().toISOString(),
			metadata: question.metadata
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
			feedbackTimer = setTimeout(() => (feedback = ''), 450);
			if (sessionAttempts.length >= 80) await endSession('target-reached');
			else showNextQuestion();
		} finally {
			submitting = false;
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
			skippedCount: reason === 'timer-expired' && currentQuestion ? 1 : 0,
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
			if (phase === 'active') void tick().then(() => answerInput?.focus());
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
		currentQuestion = null;
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

<svelte:document onvisibilitychange={handleVisibilityChange} />

<svelte:head><title>Rapid Mental Math — Think Fast</title></svelte:head>

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
				<p class="eyebrow">Rapid mental math</p>
				<h1 class="mt-3 text-5xl font-black tracking-[-0.05em]">Arithmetic under pressure.</h1>
				<p class="mt-5 max-w-xl text-lg leading-8 text-[var(--muted)]">
					Answer exact whole-number problems with the keyboard. The session stops at 80 submissions
					or when time expires.
				</p>
				<dl class="mt-8 grid grid-cols-3 gap-4 border-y border-[var(--line)] py-5 text-sm">
					<div>
						<dt class="text-[var(--muted)]">Countdown</dt>
						<dd class="mono mt-1 font-bold">3 sec</dd>
					</div>
					<div>
						<dt class="text-[var(--muted)]">Target</dt>
						<dd class="mono mt-1 font-bold">80</dd>
					</div>
					<div>
						<dt class="text-[var(--muted)]">Hidden tab</dt>
						<dd class="mt-1 font-bold">Pauses</dd>
					</div>
				</dl>
			</section>
			<form
				class="surface grid gap-5 rounded-md p-6"
				onsubmit={(event) => {
					event.preventDefault();
					void startSession();
				}}
			>
				<label class="field"
					><span>Question mix</span><select class="input" bind:value={category}
						><option value="mixed">Mixed arithmetic</option><option value="addition"
							>Addition</option
						><option value="subtraction">Subtraction</option><option value="multiplication"
							>Multiplication</option
						><option value="division">Exact division</option><option value="percentages"
							>Percentages</option
						><option value="fractions">Fractions</option></select
					></label
				>
				<label class="field"
					><span>Difficulty</span><select class="input" bind:value={difficulty}
						><option value="easy">Easy</option><option value="standard">Standard</option><option
							value="hard">Hard</option
						></select
					></label
				>
				<label class="field"
					><span>Duration</span><select class="input" bind:value={durationMs}
						><option value={120000}>2 minutes</option><option value={240000}>4 minutes</option
						><option value={480000}>8 minutes</option><option value={720000}>12 minutes</option
						></select
					></label
				>
				<button class="btn-primary mt-2" type="submit" data-testid="start-math"
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
			<p class="mt-6 text-[var(--muted)]">The clock pauses whenever this tab is hidden.</p>
			{#if paused}<p class="mt-3 font-bold text-[var(--warning)]" role="status">
					Paused — return to this tab to continue
				</p>{/if}
		</div>
	</main>
{:else if phase === 'active' && currentQuestion}
	<main class="mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-5 sm:px-8 sm:py-8">
		<header class="grid grid-cols-3 items-center border-b border-[var(--line)] pb-4 text-sm">
			<div>
				<span class="eyebrow">Question</span>
				<p class="mono mt-1 font-bold">{summary.attempted + 1} / 80</p>
			</div>
			<div class="text-center">
				<span class="eyebrow">Remaining</span>
				<p class="mono mt-1 text-2xl font-black" data-testid="math-timer">
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
		<div class="mt-3 h-1 overflow-hidden bg-[var(--surface-muted)]" aria-hidden="true">
			<div
				class="h-full bg-[var(--accent)]"
				style:width={`${Math.max((sessionAttempts.length / 80) * 100, (1 - remainingMs / durationMs) * 100)}%`}
			></div>
		</div>
		<section class="grid flex-1 place-items-center py-10 text-center" aria-labelledby="math-prompt">
			<div class="w-full max-w-3xl">
				<p class="eyebrow">Solve exactly</p>
				<h1
					id="math-prompt"
					class="mono my-10 text-[clamp(3rem,12vw,7.5rem)] font-black tracking-[-0.07em]"
				>
					{currentQuestion.prompt}
				</h1>
				<form class="mx-auto max-w-sm" onsubmit={submitAnswer}>
					<label class="sr-only" for="math-answer">Your answer</label><input
						bind:this={answerInput}
						id="math-answer"
						data-testid="math-answer"
						class="input mono h-20 text-center text-4xl font-bold"
						inputmode="numeric"
						autocomplete="off"
						bind:value={answer}
						aria-describedby="answer-error feedback"
						disabled={submitting || paused}
					/><button class="sr-only" type="submit">Submit answer</button>
					<p
						id="answer-error"
						class="mt-3 min-h-6 text-sm font-semibold text-[var(--danger)]"
						role="alert"
					>
						{answerError}
					</p>
					<p
						id="feedback"
						class={[
							'mt-1 min-h-6 text-sm font-bold',
							feedback === 'correct'
								? 'text-[var(--success)]'
								: feedback === 'incorrect'
									? 'text-[var(--danger)]'
									: ''
						]}
						aria-live="polite"
					>
						{feedback === 'correct'
							? 'Correct'
							: feedback === 'incorrect'
								? 'Incorrect — next question'
								: ''}
					</p>
				</form>
			</div>
		</section>
		<footer
			class="flex items-center justify-between border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]"
		>
			<span>Enter submits · timing uses active tab time</span><button
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
						Hidden time is excluded from your practice time and response time.
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
				<h1 class="mt-2 text-4xl font-black tracking-tight">{summary.correct} correct</h1>
				<p class="mt-2 text-[var(--muted)]">
					{resultSession.completionReason.replaceAll('-', ' ')} · saved locally
				</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<button class="btn-secondary" onclick={() => app.exportBackup()}>Export backup</button
				><button class="btn-primary" onclick={resetPractice}>Practice again</button>
			</div>
		</header>
		<section class="grid border-b border-[var(--line)] sm:grid-cols-2 lg:grid-cols-5">
			<div class="py-6">
				<p class="eyebrow">Score</p>
				<p class="metric mt-2">{summary.correct}</p>
			</div>
			<div class="py-6">
				<p class="eyebrow">Attempted</p>
				<p class="metric mt-2">{summary.attempted}</p>
			</div>
			<div class="py-6">
				<p class="eyebrow">Accuracy</p>
				<p class="metric mt-2">{summary.accuracy.toFixed(1)}%</p>
			</div>
			<div class="py-6">
				<p class="eyebrow">Avg / median</p>
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
		{#if Number.isFinite(summary.fastestCorrectMs)}<p class="mt-5 text-sm text-[var(--muted)]">
				Fastest correct response: <strong class="mono text-[var(--ink)]"
					>{(summary.fastestCorrectMs / 1000).toFixed(2)}s</strong
				>{resultSession.skippedCount
					? ` · ${resultSession.skippedCount} current question skipped at timeout`
					: ''}
			</p>{/if}
		{#if comparison}<section class="mt-8 border-l-4 border-[var(--accent)] pl-4">
				<p class="eyebrow">Compared with last {comparison.sampleSize}</p>
				<p class="mt-2 font-semibold">
					Accuracy {comparison.accuracyDelta >= 0 ? '+' : ''}{comparison.accuracyDelta.toFixed(1)} points
					· response time {comparison.responseDeltaMs <= 0 ? 'faster by' : 'slower by'}
					{Math.abs(comparison.responseDeltaMs / 1000).toFixed(2)}s
				</p>
			</section>{/if}
		<section class="mt-10 grid gap-10 lg:grid-cols-2">
			<div>
				<p class="eyebrow">Breakdown</p>
				<h2 class="mt-1 text-xl font-bold">By category</h2>
				{#if breakdown.length}<div
						class="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]"
					>
						{#each breakdown as item (item.key)}<div
								class="grid grid-cols-[1fr_auto_auto] gap-5 py-3"
							>
								<span class="capitalize">{item.key}</span><span class="mono text-[var(--muted)]"
									>{item.correct}/{item.attempted}</span
								><strong class="mono">{item.accuracy.toFixed(0)}%</strong>
							</div>{/each}
					</div>{:else}<p class="mt-4 text-[var(--muted)]">No answers were submitted.</p>{/if}
			</div>
			<div>
				<p class="eyebrow">Review</p>
				<h2 class="mt-1 text-xl font-bold">Incorrect answers</h2>
				{#if incorrectAttempts.length}<ol
						class="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]"
					>
						{#each incorrectAttempts as attempt (attempt.id)}<li
								class="grid grid-cols-[1fr_auto] gap-4 py-3"
							>
								<span class="mono font-bold">{attempt.prompt}</span><span class="text-right text-sm"
									><span class="text-[var(--danger)]">{attempt.submittedAnswer}</span><span
										class="mx-2 text-[var(--muted)]">→</span
									><strong>{attempt.expectedAnswer}</strong></span
								>
							</li>{/each}
					</ol>{:else}<p class="mt-4 font-semibold text-[var(--success)]">
						No incorrect answers in this session.
					</p>{/if}
			</div>
		</section>
		<a href={resolve('/')} class="btn-quiet mt-10">← Return to dashboard</a>
	</main>
{/if}
