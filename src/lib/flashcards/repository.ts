import { getDatabase } from '../data/repository';
export interface Deck {
	id: string;
	name: string;
	description: string;
}
export interface Card {
	id: string;
	deckId: string;
	front: string;
	back: string;
}
export async function decks() {
	return (await getDatabase()).getAll('flashDecks');
}
export async function saveDeck(deck: Deck) {
	await (await getDatabase()).put('flashDecks', deck);
}
export async function cards(deckId: string) {
	return (await getDatabase()).getAllFromIndex('flashCards', 'by-deck', deckId);
}
export async function saveCard(card: Card) {
	if (!card.front.trim() || !card.back.trim()) throw new Error('Front and back are required.');
	await (await getDatabase()).put('flashCards', card);
}
export async function coverage(items: Card[]) {
	const db = await getDatabase();
	return (await Promise.all(items.map((c) => db.get('flashProgress', 'default:' + c.id)))).filter(
		Boolean
	).length;
}
export async function study(card: Card, status?: Exclude<StudyStatus, 'new'>) {
	const previous = await (await getDatabase()).get('flashProgress', 'default:' + card.id);
	await (
		await getDatabase()
	).put('flashProgress', {
		...previous,
		id: 'default:' + card.id,
		studiedAt: new Date().toISOString(),
		status: status ?? previous?.status ?? 'learning'
	});
}

export async function importCards(deck: Deck, incoming: Card[]) {
	const db = await getDatabase();
	const tx = db.transaction(['flashDecks', 'flashCards'], 'readwrite');
	await tx.objectStore('flashDecks').put(deck);
	for (const card of incoming) await tx.objectStore('flashCards').put(card);
	await tx.done;
}

export async function removeCard(id: string) {
	await (await getDatabase()).delete('flashCards', id);
}
export async function summary(items: Card[]) {
	const db = await getDatabase();
	const states = await Promise.all(items.map((c) => db.get('flashLearning', 'default:' + c.id)));
	const progress = await Promise.all(items.map((c) => db.get('flashProgress', 'default:' + c.id)));
	return {
		new: states.filter((s) => !s || s.card.state === 0).length,
		learning: states.filter((s) => s?.card.state === 1 || s?.card.state === 3).length,
		review: states.filter((s) => s?.card.state === 2).length,
		due: states.filter((s) => s && new Date(s.card.due).getTime() <= Date.now()).length,
		studied: progress.filter(Boolean).length,
		last:
			progress
				.map((p) => p?.studiedAt ?? '')
				.sort()
				.at(-1) || ''
	};
}

export async function deckProgress(deckId: string) {
	const { readFlashBackup } = await import('./backup');
	const data = await readFlashBackup();
	const ids = new Set(data.cards.filter((c) => c.deckId === deckId).map((c) => 'default:' + c.id));
	return {
		progress: data.progress.filter((p) => ids.has(p.id)),
		learning: data.learning.filter((p) => ids.has(p.id)),
		reviews: data.reviews.filter((r) => r.deckId === deckId)
	};
}
export async function restoreDocument(
	doc: import('zod').infer<typeof import('./transfer').documentSchema>
) {
	const { hydrateLearning } = await import('./backup');
	const db = await getDatabase();
	const tx = db.transaction(
		['flashDecks', 'flashCards', 'flashProgress', 'flashLearning', 'flashReviews'],
		'readwrite'
	);
	await tx.objectStore('flashDecks').put(doc.deck);
	for (const card of doc.cards) {
		const existing = await tx.objectStore('flashCards').get(card.id);
		if (existing && existing.deckId !== doc.deck.id) {
			tx.abort();
			throw new Error('A card ID belongs to another deck. Import as a new copy.');
		}
		await tx.objectStore('flashCards').put(card);
	}
	const ids = new Set(doc.cards.map((c) => 'default:' + c.id));
	for (const p of doc.progress ?? []) {
		if (!ids.has(p.id)) {
			tx.abort();
			throw new Error('Unrelated progress in deck document.');
		}
		if (!(await tx.objectStore('flashProgress').get(p.id)))
			await tx.objectStore('flashProgress').put(p);
	}
	for (const l of doc.learning ?? []) {
		if (!ids.has(l.id)) {
			tx.abort();
			throw new Error('Unrelated learning state.');
		}
		if (!(await tx.objectStore('flashLearning').get(l.id)))
			await tx.objectStore('flashLearning').put(hydrateLearning(l));
	}
	for (const r of doc.reviews ?? []) {
		if (r.deckId !== doc.deck.id || !ids.has('default:' + r.cardId)) {
			tx.abort();
			throw new Error('Unrelated review event.');
		}
		if (!(await tx.objectStore('flashReviews').get(r.id)))
			await tx.objectStore('flashReviews').put({
				...r,
				next: hydrateLearning(r.next),
				previous: r.previous ? hydrateLearning(r.previous) : undefined
			});
	}
	await tx.done;
}

export type StudyStatus = 'new' | 'learning' | 'review' | 'memorized';

export function studyStatus(card?: { state: number; scheduled_days: number }): StudyStatus {
	if (!card || card.state === 0) return 'new';
	if (card.state === 1 || card.state === 3) return 'learning';
	return card.scheduled_days >= 21 ? 'memorized' : 'review';
}

export async function studyStatuses(
	items: Card[],
	mode = 'scheduled'
): Promise<Record<string, StudyStatus>> {
	const db = await getDatabase();
	return Object.fromEntries(
		await Promise.all(
			items.map(async (item) => {
				const learning = await db.get('flashLearning', 'default:' + item.id);
				const progress = await db.get('flashProgress', 'default:' + item.id);
				return [
					item.id,
					mode === 'random'
						? (progress?.status ?? (progress ? 'learning' : 'new'))
						: studyStatus(learning?.card)
				];
			})
		)
	);
}
