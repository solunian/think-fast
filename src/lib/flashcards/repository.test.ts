import { describe, expect, it } from 'vitest';
import { studyStatus } from './repository';

describe('study labels', () => {
	it('classifies unseen and reset cards as new', () => {
		expect(studyStatus()).toBe('new');
		expect(studyStatus({ state: 0, scheduled_days: 0 })).toBe('new');
	});
	it('keeps learning and relearning cards in learning', () => {
		for (const state of [1, 3]) {
			expect(studyStatus({ state, scheduled_days: 30 })).toBe('learning');
		}
	});
	it('separates review and memorized cards at a 21-day interval', () => {
		expect(studyStatus({ state: 2, scheduled_days: 20 })).toBe('review');
		expect(studyStatus({ state: 2, scheduled_days: 21 })).toBe('memorized');
	});
});
