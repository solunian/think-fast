import { accuracy, average } from './scoring';
import type { AppSnapshot, AttemptRecord, Difficulty, ExerciseType, SessionRecord } from './types';

export interface HistoryFilters {
	exercise: ExerciseType | 'all';
	category: string;
	difficulty: Difficulty | 'all';
	dateRange: 'all' | '7d' | '30d' | '90d';
}

export function filteredHistory(snapshot: AppSnapshot, filters: HistoryFilters, now = new Date()) {
	const cutoffDays = filters.dateRange === 'all' ? null : Number.parseInt(filters.dateRange, 10);
	const cutoff = cutoffDays === null ? null : now.getTime() - cutoffDays * 86_400_000;
	let sessions = snapshot.sessions.filter((session) => {
		return (
			(filters.exercise === 'all' || session.exerciseType === filters.exercise) &&
			(filters.difficulty === 'all' || session.difficulty === filters.difficulty) &&
			(cutoff === null || new Date(session.startedAt).getTime() >= cutoff)
		);
	});
	const sessionIds = new Set(sessions.map((session) => session.id));
	const allSessionIds = new Set(snapshot.sessions.map((session) => session.id));
	const attempts = snapshot.attempts.filter((attempt) => {
		const belongsToFilteredSession = sessionIds.has(attempt.sessionId);
		const isMatchingOrphan =
			!allSessionIds.has(attempt.sessionId) &&
			(filters.exercise === 'all' || attempt.exerciseType === filters.exercise) &&
			(filters.difficulty === 'all' || attempt.difficulty === filters.difficulty) &&
			(cutoff === null || new Date(attempt.timestamp).getTime() >= cutoff);
		return (
			(belongsToFilteredSession || isMatchingOrphan) &&
			(filters.category === 'all' || attempt.problemCategory === filters.category)
		);
	});
	if (filters.category !== 'all') {
		const matchingSessionIds = new Set(attempts.map((attempt) => attempt.sessionId));
		sessions = sessions.filter((session) => matchingSessionIds.has(session.id));
	}
	return { sessions, attempts };
}

export function calculateStreak(sessions: SessionRecord[], now = new Date()): number {
	const practicedDays = new Set(
		sessions
			.filter((session) => session.activeDurationMs > 0)
			.map((session) => new Date(session.startedAt).toLocaleDateString('en-CA'))
	);
	let streak = 0;
	const cursor = new Date(now);
	cursor.setHours(0, 0, 0, 0);
	if (!practicedDays.has(cursor.toLocaleDateString('en-CA'))) cursor.setDate(cursor.getDate() - 1);
	while (practicedDays.has(cursor.toLocaleDateString('en-CA'))) {
		streak += 1;
		cursor.setDate(cursor.getDate() - 1);
	}
	return streak;
}

export function dashboardSummary(snapshot: AppSnapshot) {
	const attempts = snapshot.attempts;
	const completed = snapshot.sessions.filter(
		(session) => session.completionReason !== 'interrupted'
	);
	const correct = attempts.filter((attempt) => attempt.correct).length;
	return {
		totalPracticeMs: snapshot.sessions.reduce(
			(total, session) => total + session.activeDurationMs,
			0
		),
		overallAccuracy: accuracy(correct, attempts.length),
		completedSessions: completed.length,
		streak: calculateStreak(snapshot.sessions),
		attemptCount: attempts.length
	};
}

export function groupAttempts(
	attempts: AttemptRecord[],
	key: (attempt: AttemptRecord) => string
): Array<{
	key: string;
	attempted: number;
	correct: number;
	accuracy: number;
	averageResponseMs: number;
}> {
	const groups = new Map<string, AttemptRecord[]>();
	for (const attempt of attempts) {
		const groupKey = key(attempt);
		groups.set(groupKey, [...(groups.get(groupKey) ?? []), attempt]);
	}
	return [...groups.entries()].map(([groupKey, values]) => {
		const correct = values.filter((attempt) => attempt.correct).length;
		return {
			key: groupKey,
			attempted: values.length,
			correct,
			accuracy: accuracy(correct, values.length),
			averageResponseMs: average(values.map((attempt) => attempt.responseTimeMs))
		};
	});
}

export function recentComparison(
	current: SessionRecord,
	sessions: SessionRecord[]
): { accuracyDelta: number; responseDeltaMs: number; sampleSize: number } | null {
	const previous = sessions
		.filter(
			(session) =>
				session.id !== current.id &&
				session.exerciseType === current.exerciseType &&
				session.completionReason !== 'interrupted'
		)
		.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
		.slice(0, 5);
	if (previous.length < 2) return null;
	const previousAccuracy = average(
		previous.map((session) => accuracy(session.correctCount, session.attemptedCount))
	);
	return {
		accuracyDelta: accuracy(current.correctCount, current.attemptedCount) - previousAccuracy,
		responseDeltaMs:
			current.averageResponseMs - average(previous.map((session) => session.averageResponseMs)),
		sampleSize: previous.length
	};
}

export function trendPoints(sessions: SessionRecord[], limit = 12) {
	return sessions
		.filter((session) => session.attemptedCount > 0)
		.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
		.slice(-limit)
		.map((session) => ({
			id: session.id,
			date: session.startedAt,
			accuracy: accuracy(session.correctCount, session.attemptedCount),
			averageResponseMs: session.averageResponseMs,
			exercise: session.exerciseType
		}));
}
