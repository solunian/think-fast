import { describe, expect, test } from 'vitest';
import { accuracy, average, median, summarizeAttempts } from './scoring';
import type { AttemptRecord } from './types';

function attempt(id: string, correct: boolean, responseTimeMs: number): AttemptRecord {
	return {
		id,
		sessionId: 'session',
		exerciseType: 'mental-math',
		problemCategory: 'addition',
		prompt: '1 + 1',
		submittedAnswer: correct ? 2 : 3,
		expectedAnswer: 2,
		correct,
		responseTimeMs,
		difficulty: 'standard',
		timestamp: '2026-08-31T18:30:00.000Z'
	};
}

describe('scoring', () => {
	test('handles empty collections and division by zero', () => {
		expect(average([])).toBe(0);
		expect(median([])).toBe(0);
		expect(accuracy(0, 0)).toBe(0);
	});

	test('calculates average and odd/even medians', () => {
		expect(average([100, 200, 600])).toBe(300);
		expect(median([900, 100, 500])).toBe(500);
		expect(median([400, 100, 300, 200])).toBe(250);
	});

	test('summarizes correctness and response times', () => {
		const summary = summarizeAttempts([
			attempt('a', true, 900),
			attempt('b', false, 1500),
			attempt('c', true, 600)
		]);
		expect(summary).toMatchObject({ attempted: 3, correct: 2, incorrect: 1 });
		expect(summary.accuracy).toBeCloseTo(66.666, 2);
		expect(summary.averageResponseMs).toBe(1000);
		expect(summary.medianResponseMs).toBe(900);
		expect(summary.fastestCorrectMs).toBe(600);
	});
});
