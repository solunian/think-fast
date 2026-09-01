import { pick, randomInt, shuffle, type RandomSource } from './random';
import type { ArrowDirection, Difficulty, PatternTrial } from './types';

export const arrowDirections: readonly ArrowDirection[] = ['up', 'right', 'down', 'left'];

export function patternSize(difficulty: Difficulty): 2 | 3 | 4 {
	return difficulty === 'easy' ? 2 : difficulty === 'standard' ? 3 : 4;
}

export function createBalancedPatternAnswers(random: RandomSource, count = 10): boolean[] {
	const sameCount = Math.floor(count / 2);
	return shuffle(random, [
		...Array.from({ length: sameCount }, () => true),
		...Array.from({ length: count - sameCount }, () => false)
	]);
}

export function generatePatternTrial(
	random: RandomSource,
	difficulty: Difficulty,
	isSame: boolean
): PatternTrial {
	const size = patternSize(difficulty);
	const cellCount = size * size;
	const left = Array.from({ length: cellCount }, () => pick(random, arrowDirections));
	const right = [...left];
	const mismatchIndices: number[] = [];

	if (!isSame) {
		const maxMismatches = difficulty === 'hard' ? 3 : difficulty === 'standard' ? 2 : 1;
		const mismatchCount = randomInt(random, 1, maxMismatches);
		for (const index of shuffle(
			random,
			Array.from({ length: cellCount }, (_, item) => item)
		).slice(0, mismatchCount)) {
			mismatchIndices.push(index);
			right[index] = pick(
				random,
				arrowDirections.filter((direction) => direction !== left[index])
			);
		}
	}

	return {
		left,
		right,
		size,
		isSame,
		mismatchIndices: mismatchIndices.sort((a, b) => a - b),
		signature: `${left.join('')}:${right.join('')}`
	};
}

export function compactPattern(trial: PatternTrial): string {
	const abbreviations: Record<ArrowDirection, string> = {
		up: '↑',
		right: '→',
		down: '↓',
		left: '←'
	};
	return `${trial.left.map((item) => abbreviations[item]).join('')} | ${trial.right
		.map((item) => abbreviations[item])
		.join('')}`;
}
