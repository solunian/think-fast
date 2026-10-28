import { describe, it, expect } from 'vitest';
import { parseCsv, exportCsv, documentSchema } from './transfer';
describe('deck transfer', () => {
	it('preserves multiline Unicode and formula-like text', () => {
		const deck = { id: 'd', name: 'test', description: '' };
		const cards = ['=SUM(A1)', 'hello\n世界', "'literal", '-2'].map((front, i) => ({
			id: String(i),
			deckId: 'd',
			front,
			back: 'quoted "answer", yes'
		}));
		expect(parseCsv(exportCsv(deck, cards)).cards).toEqual(
			cards.map(({ front, back }) => ({ front, back }))
		);
	});
	it('reports invalid rows without silently accepting them', () => {
		const result = parseCsv('front,back\nvalid,answer\nmissing,');
		expect(result.cards).toHaveLength(1);
		expect(result.errors).toHaveLength(1);
	});
	it('rejects broken references', () => {
		expect(() =>
			documentSchema.parse({
				format: 'think-fast-deck',
				version: 1,
				exportedAt: 'now',
				deck: { id: 'a', name: 'A', description: '' },
				cards: [{ id: 'x', deckId: 'b', front: 'a', back: 'b' }]
			})
		).toThrow();
	});
});
