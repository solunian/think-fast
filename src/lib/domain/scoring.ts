import type { AttemptRecord } from './types';

export function average(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((total, value) => total + value, 0) / values.length;
}

export function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const midpoint = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[midpoint - 1] + sorted[midpoint]) / 2 : sorted[midpoint];
}

export function accuracy(correct: number, attempted: number): number {
	return attempted > 0 ? (correct / attempted) * 100 : 0;
}

export function summarizeAttempts(attempts: AttemptRecord[]) {
	const correct = attempts.filter((attempt) => attempt.correct).length;
	const responseTimes = attempts.map((attempt) => attempt.responseTimeMs);
	return {
		attempted: attempts.length,
		correct,
		incorrect: attempts.length - correct,
		accuracy: accuracy(correct, attempts.length),
		averageResponseMs: average(responseTimes),
		medianResponseMs: median(responseTimes),
		fastestCorrectMs: Math.min(
			...attempts.filter((attempt) => attempt.correct).map((attempt) => attempt.responseTimeMs),
			Number.POSITIVE_INFINITY
		)
	};
}
