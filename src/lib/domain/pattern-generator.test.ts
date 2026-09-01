import { describe, expect, test } from 'vitest';
import {
	createBalancedPatternAnswers,
	generatePatternTrial,
	patternSize
} from './pattern-generator';
import { createSeededRandom } from './random';

describe('arrow-pattern generator', () => {
	test('maps difficulty to 2×2, 3×3, and 4×4 grids', () => {
		expect(patternSize('easy')).toBe(2);
		expect(patternSize('standard')).toBe(3);
		expect(patternSize('hard')).toBe(4);
	});

	test.each(['easy', 'standard', 'hard'] as const)(
		'same %s trials match every cell',
		(difficulty) => {
			const trial = generatePatternTrial(createSeededRandom(10), difficulty, true);
			expect(trial.left).toEqual(trial.right);
			expect(trial.mismatchIndices).toEqual([]);
			expect(trial.left).toHaveLength(trial.size ** 2);
		}
	);

	test.each(['easy', 'standard', 'hard'] as const)(
		'different %s trials guarantee real mismatches',
		(difficulty) => {
			const random = createSeededRandom(29);
			for (let index = 0; index < 100; index += 1) {
				const trial = generatePatternTrial(random, difficulty, false);
				expect(trial.mismatchIndices.length).toBeGreaterThanOrEqual(1);
				for (const mismatch of trial.mismatchIndices) {
					expect(trial.left[mismatch]).not.toBe(trial.right[mismatch]);
				}
			}
		}
	);

	test('answer decks are balanced without a fixed alternating sequence', () => {
		const deck = createBalancedPatternAnswers(createSeededRandom(99), 10);
		expect(deck.filter(Boolean)).toHaveLength(5);
		expect(deck.filter((answer) => !answer)).toHaveLength(5);
		expect(deck).not.toEqual([true, false, true, false, true, false, true, false, true, false]);
	});
});
