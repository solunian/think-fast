export type RandomSource = () => number;

export function createSeededRandom(seed: number): RandomSource {
	let value = seed >>> 0;
	return () => {
		value += 0x6d2b79f5;
		let result = value;
		result = Math.imul(result ^ (result >>> 15), result | 1);
		result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
		return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
	};
}

export function randomInt(random: RandomSource, min: number, max: number): number {
	return Math.floor(random() * (max - min + 1)) + min;
}

export function pick<T>(random: RandomSource, values: readonly T[]): T {
	return values[Math.min(values.length - 1, Math.floor(random() * values.length))];
}

export function shuffle<T>(random: RandomSource, values: readonly T[]): T[] {
	const copy = [...values];
	for (let index = copy.length - 1; index > 0; index -= 1) {
		const target = randomInt(random, 0, index);
		[copy[index], copy[target]] = [copy[target], copy[index]];
	}
	return copy;
}
