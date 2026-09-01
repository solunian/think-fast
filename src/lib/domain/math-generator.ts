import type { Difficulty, MathQuestion, MentalMathCategory } from './types';
import { pick, randomInt, type RandomSource } from './random';

const concreteCategories: MentalMathCategory[] = [
	'addition',
	'subtraction',
	'multiplication',
	'division',
	'percentages',
	'fractions',
	'mixed'
];

const ranges = {
	easy: { add: [10, 99], multA: [2, 12], multB: [2, 12], divisor: [2, 10], quotient: [2, 20] },
	standard: {
		add: [25, 499],
		multA: [4, 25],
		multB: [3, 15],
		divisor: [3, 18],
		quotient: [4, 40]
	},
	hard: {
		add: [100, 999],
		multA: [11, 99],
		multB: [4, 25],
		divisor: [6, 30],
		quotient: [10, 80]
	}
} as const;

function makeQuestion(
	category: MentalMathCategory,
	prompt: string,
	expectedAnswer: number,
	metadata: Record<string, unknown>
): MathQuestion {
	return { category, prompt, expectedAnswer, signature: `${category}:${prompt}`, metadata };
}

function generateOnce(
	random: RandomSource,
	difficulty: Difficulty,
	requestedCategory: MentalMathCategory
): MathQuestion {
	const config = ranges[difficulty];
	const category =
		requestedCategory === 'mixed' ? pick(random, concreteCategories) : requestedCategory;

	if (category === 'addition') {
		const a = randomInt(random, config.add[0], config.add[1]);
		const b = randomInt(random, config.add[0], config.add[1]);
		return makeQuestion(category, `${a} + ${b}`, a + b, { operands: [a, b], operation: '+' });
	}

	if (category === 'subtraction') {
		const first = randomInt(random, config.add[0], config.add[1]);
		const second = randomInt(random, config.add[0], config.add[1]);
		const [a, b] = first >= second ? [first, second] : [second, first];
		return makeQuestion(category, `${a} − ${b}`, a - b, { operands: [a, b], operation: '-' });
	}

	if (category === 'multiplication') {
		const a = randomInt(random, config.multA[0], config.multA[1]);
		const b = randomInt(random, config.multB[0], config.multB[1]);
		return makeQuestion(category, `${a} × ${b}`, a * b, { operands: [a, b], operation: '*' });
	}

	if (category === 'division') {
		const divisor = randomInt(random, config.divisor[0], config.divisor[1]);
		const quotient = randomInt(random, config.quotient[0], config.quotient[1]);
		const dividend = divisor * quotient;
		return makeQuestion(category, `${dividend} ÷ ${divisor}`, quotient, {
			operands: [dividend, divisor],
			operation: '/'
		});
	}

	if (category === 'percentages') {
		const percent = pick(random, difficulty === 'easy' ? [10, 25, 50] : [5, 10, 20, 25, 50, 75]);
		const unit =
			percent === 75 ? 4 : percent === 25 ? 4 : percent === 20 ? 5 : percent === 5 ? 20 : 10;
		const base = randomInt(random, 2, difficulty === 'hard' ? 30 : 15) * unit;
		return makeQuestion(category, `${percent}% of ${base}`, (percent * base) / 100, {
			percent,
			base
		});
	}

	if (category === 'fractions') {
		const denominator = pick(random, difficulty === 'easy' ? [2, 3, 4] : [3, 4, 5, 6, 8]);
		const numerator = randomInt(random, 1, denominator - 1);
		const multiple = randomInt(random, 2, difficulty === 'hard' ? 30 : 16);
		const whole = denominator * multiple;
		return makeQuestion(category, `${numerator}/${denominator} of ${whole}`, numerator * multiple, {
			numerator,
			denominator,
			whole
		});
	}

	const a = randomInt(random, difficulty === 'hard' ? 20 : 5, difficulty === 'hard' ? 120 : 40);
	const b = randomInt(random, 2, difficulty === 'hard' ? 18 : 10);
	const c = randomInt(random, 2, difficulty === 'hard' ? 15 : 9);
	return makeQuestion('mixed', `${a} + ${b} × ${c}`, a + b * c, {
		operands: [a, b, c],
		operations: ['+', '*']
	});
}

export function generateMathQuestion(
	random: RandomSource,
	difficulty: Difficulty,
	category: MentalMathCategory = 'mixed',
	previousSignature?: string
): MathQuestion {
	let question = generateOnce(random, difficulty, category);
	for (let attempt = 0; attempt < 8 && question.signature === previousSignature; attempt += 1) {
		question = generateOnce(random, difficulty, category);
	}
	return question;
}
