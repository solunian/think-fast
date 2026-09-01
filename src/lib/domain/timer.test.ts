import { describe, expect, test } from 'vitest';
import { ActiveTimer, formatDuration } from './timer';

describe('active timer', () => {
	test('uses monotonic elapsed time and corrects long gaps', () => {
		let now = 100;
		const timer = new ActiveTimer(10_000, () => now);
		timer.start();
		now = 3_850;
		expect(timer.elapsedMs()).toBe(3_750);
		expect(timer.remainingMs()).toBe(6_250);
		now = 20_000;
		expect(timer.isExpired()).toBe(true);
	});

	test('excludes paused time from active duration', () => {
		let now = 0;
		const timer = new ActiveTimer(10_000, () => now);
		timer.start();
		now = 2_000;
		timer.pause();
		now = 12_000;
		expect(timer.elapsedMs()).toBe(2_000);
		timer.resume();
		now = 13_250;
		expect(timer.stop()).toBe(3_250);
	});

	test('formats countdown durations', () => {
		expect(formatDuration(0)).toBe('0:00');
		expect(formatDuration(60_001)).toBe('1:01');
	});
});
