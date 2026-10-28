import z from 'zod';

const date = z.string().datetime();
const scheduled = z.object({
	due: date,
	stability: z.number(),
	difficulty: z.number(),
	elapsed_days: z.number(),
	scheduled_days: z.number(),
	learning_steps: z.number(),
	reps: z.number(),
	lapses: z.number(),
	state: z.number().int().min(0).max(3),
	last_review: date.optional()
});
const learning = z.object({
	id: z.string(),
	revision: z.number().int().nonnegative(),
	card: scheduled
});
export const flashBackupSchema = z
	.object({
		decks: z.array(z.object({ id: z.string(), name: z.string(), description: z.string() })),
		cards: z.array(
			z.object({ id: z.string(), deckId: z.string(), front: z.string(), back: z.string() })
		),
		progress: z.array(z.object({ id: z.string(), studiedAt: date })),
		learning: z.array(learning),
		reviews: z.array(
			z.object({
				id: z.string(),
				cardId: z.string(),
				deckId: z.string(),
				at: date,
				rating: z.number().int().min(1).max(4),
				scheduler: z.string(),
				previous: learning.optional(),
				next: learning,
				undone: z.boolean(),
				previousProgress: z.object({ id: z.string(), studiedAt: date }).optional()
			})
		)
	})
	.superRefine((data, ctx) => {
		const decks = new Set(data.decks.map((d) => d.id));
		const cards = new Set(data.cards.map((c) => c.id));
		if (
			decks.size !== data.decks.length ||
			cards.size !== data.cards.length ||
			data.cards.some((c) => !decks.has(c.deckId))
		)
			ctx.addIssue({
				code: 'custom',
				message: 'Flashcard backup contains duplicate IDs or broken references.'
			});
	});
export type FlashBackup = z.infer<typeof flashBackupSchema>;
export async function readFlashBackup(): Promise<FlashBackup> {
	const { getDatabase } = await import('../data/repository');
	const db = await getDatabase();
	const tx = db.transaction([
		'flashDecks',
		'flashCards',
		'flashProgress',
		'flashLearning',
		'flashReviews'
	]);
	const [decks, cards, progress, learning, reviews] = await Promise.all([
		tx.objectStore('flashDecks').getAll(),
		tx.objectStore('flashCards').getAll(),
		tx.objectStore('flashProgress').getAll(),
		tx.objectStore('flashLearning').getAll(),
		tx.objectStore('flashReviews').getAll()
	]);
	await tx.done;
	return flashBackupSchema.parse(
		JSON.parse(JSON.stringify({ decks, cards, progress, learning, reviews }))
	);
}
export function hydrateLearning(item: FlashBackup['learning'][number]) {
	return {
		...item,
		card: {
			...item.card,
			due: new Date(item.card.due),
			last_review: item.card.last_review ? new Date(item.card.last_review) : undefined
		}
	};
}
