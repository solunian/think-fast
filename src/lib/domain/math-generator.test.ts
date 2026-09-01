import { describe, expect, test } from 'vitest';
import { generateMathQuestion } from './math-generator';
import { createSeededRandom } from './random';
import type { Difficulty, MentalMathCategory } from './types';

const categories: MentalMathCategory[] = [
	'addition',
	'subtraction',
	'multiplication',
	'division',
	'percentages',
	'fractions',
	'mixed'
];

describe('mental-math generator', () => {
	test.each(categories)('generates exact integer answers for %s', (category) => {
		const random = createSeededRandom(42);
		for (let index = 0; index < 250; index += 1) {
			const question = generateMathQuestion(random, 'standard', category);
			expect(Number.isInteger(question.expectedAnswer)).toBe(true);
			expect(question.prompt.length).toBeGreaterThan(2);
		}
	});

	test('division always has an exact non-zero divisor and matching quotient', () => {
		const random = createSeededRandom(8765);
		for (let index = 0; index < 500; index += 1) {
			const question = generateMathQuestion(random, 'hard', 'division');
			const [dividend, divisor] = question.metadata.operands as number[];
			expect(divisor).toBeGreaterThan(0);
			expect(dividend % divisor).toBe(0);
			expect(dividend / divisor).toBe(question.expectedAnswer);
		}
	});

	test.each([
		['easy', 10, 99],
		['standard', 25, 499],
		['hard', 100, 999]
	] as const)('%s addition respects configured operand ranges', (difficulty, min, max) => {
		const random = createSeededRandom(13);
		for (let index = 0; index < 100; index += 1) {
			const question = generateMathQuestion(random, difficulty as Difficulty, 'addition');
			const operands = question.metadata.operands as number[];
			expect(operands.every((operand) => operand >= min && operand <= max)).toBe(true);
		}
	});

	test('avoids immediate duplicates with seeded randomness', () => {
		const random = createSeededRandom(1);
		let previous = '';
		for (let index = 0; index < 200; index += 1) {
			const question = generateMathQuestion(random, 'easy', 'addition', previous);
			expect(question.signature).not.toBe(previous);
			previous = question.signature;
		}
	});
});
