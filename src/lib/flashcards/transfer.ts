import { flashBackupSchema } from './backup';
import Papa from 'papaparse';
import z from 'zod';
import type { Card, Deck } from './repository';
const cardSchema = z.object({
	id: z.string().min(1),
	deckId: z.string().min(1),
	front: z.string().min(1),
	back: z.string().min(1)
});
export const documentSchema = z
	.object({
		format: z.literal('think-fast-deck'),
		version: z.literal(1),
		exportedAt: z.string(),
		deck: z.object({ id: z.string().min(1), name: z.string().min(1), description: z.string() }),
		cards: z.array(cardSchema).max(50000),
		progress: flashBackupSchema.shape.progress.optional(),
		learning: flashBackupSchema.shape.learning.optional(),
		reviews: flashBackupSchema.shape.reviews.optional()
	})
	.superRefine((doc, ctx) => {
		if (
			new Set(doc.cards.map((c) => c.id)).size !== doc.cards.length ||
			doc.cards.some((c) => c.deckId !== doc.deck.id)
		)
			ctx.addIssue({ code: 'custom', message: 'Duplicate card IDs or broken deck references.' });
	});
export function exportJson(
	deck: Deck,
	cards: Card[],
	progress?: Pick<import('./backup').FlashBackup, 'progress' | 'learning' | 'reviews'>
) {
	return JSON.stringify(
		{
			...progress,
			format: 'think-fast-deck',
			version: 1,
			exportedAt: new Date().toISOString(),
			deck,
			cards
		},
		null,
		2
	);
}
export function exportCsv(deck: Deck, cards: Card[]) {
	const escape = (s: string) => (/^[=+\-@\t\r']/.test(s) ? "'" + s : s);
	return Papa.unparse({
		fields: [
			'deck',
			'card_id',
			'note_id',
			'note_type',
			'front',
			'back',
			'tags',
			'think_fast_escape'
		],
		data: [...cards]
			.sort((a, b) => a.id.localeCompare(b.id))
			.map((c) => [
				escape(deck.name),
				c.id,
				c.id,
				'basic',
				escape(c.front),
				escape(c.back),
				'[]',
				'apostrophe-v1'
			])
	});
}
export function parseCsv(
	text: string,
	delimiter = ',',
	header = true,
	frontColumn = 0,
	backColumn = 1
) {
	const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
		delimiter,
		skipEmptyLines: 'greedy'
	});
	const rows = parsed.data;
	const headers = header ? (rows.shift() ?? []) : [];
	if (header && headers.includes('front') && headers.includes('back')) {
		frontColumn = headers.indexOf('front');
		backColumn = headers.indexOf('back');
	}
	const escaped = headers.indexOf('think_fast_escape');
	const errors = parsed.errors.map((e) => 'Row ' + ((e.row ?? 0) + 1) + ': ' + e.message);
	const cards: { front: string; back: string }[] = [];
	rows.forEach((row, i) => {
		const decode = (s: string) =>
			escaped >= 0 && row[escaped] === 'apostrophe-v1' && s.startsWith("'") ? s.slice(1) : s;
		const front = decode(row[frontColumn] ?? '');
		const back = decode(row[backColumn] ?? '');
		if (!front.trim() || !back.trim())
			errors.push('Row ' + (i + (header ? 2 : 1)) + ': front and back are required.');
		else cards.push({ front, back });
	});
	return {
		cards,
		errors,
		headers,
		duplicates: cards.length - new Set(cards.map((c) => JSON.stringify(c))).size
	};
}
export function download(text: string, name: string, type: string) {
	const url = URL.createObjectURL(new Blob([text], { type }));
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
