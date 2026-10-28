import { createEmptyCard, fsrs, type Card as ScheduledCard, type Grade } from 'ts-fsrs';
import { getDatabase } from '../data/repository';
export interface Learning {
	id: string;
	revision: number;
	card: ScheduledCard;
}
export interface Review {
	id: string;
	cardId: string;
	deckId: string;
	at: string;
	rating: number;
	scheduler: string;
	previous: Learning | undefined;
	next: Learning;
	undone: boolean;
	previousProgress?: {
		id: string;
		studiedAt: string;
		status?: 'learning' | 'review' | 'memorized';
	};
}
const scheduler = fsrs({ enable_fuzz: false });
export async function predictions(cardId: string, now = new Date()) {
	const state = await (await getDatabase()).get('flashLearning', 'default:' + cardId);
	return { state, choices: scheduler.repeat(state?.card ?? createEmptyCard(now), now) };
}
export async function rate(
	cardId: string,
	deckId: string,
	grade: Grade,
	expected: number,
	now = new Date()
) {
	const prediction = await predictions(cardId, now);
	if ((prediction.state?.revision ?? 0) !== expected)
		throw new Error('This card changed in another tab. Restart practice to refresh.');
	const next = {
		id: 'default:' + cardId,
		revision: expected + 1,
		card: prediction.choices[grade].card
	};
	const event: Review = {
		id: crypto.randomUUID(),
		cardId,
		deckId,
		at: now.toISOString(),
		rating: grade,
		scheduler: 'ts-fsrs@5.4.2;default;fuzz=false',
		previous: prediction.state,
		next,
		undone: false
	};
	const db = await getDatabase();
	const tx = db.transaction(['flashLearning', 'flashReviews', 'flashProgress'], 'readwrite');
	const current = await tx.objectStore('flashLearning').get(next.id);
	if ((current?.revision ?? 0) !== expected) {
		tx.abort();
		throw new Error('Concurrent review detected. Restart practice.');
	}
	event.previousProgress = await tx.objectStore('flashProgress').get(next.id);
	await tx.objectStore('flashLearning').put(next);
	await tx.objectStore('flashReviews').add(event);
	await tx
		.objectStore('flashProgress')
		.put({ ...event.previousProgress, id: next.id, studiedAt: event.at });
	await tx.done;
	return event;
}
export async function undo(event: Review) {
	const db = await getDatabase();
	const tx = db.transaction(['flashLearning', 'flashReviews', 'flashProgress'], 'readwrite');
	const current = await tx.objectStore('flashLearning').get(event.next.id);
	const stored = await tx.objectStore('flashReviews').get(event.id);
	if (current?.revision !== event.next.revision || stored?.undone) {
		tx.abort();
		throw new Error('Cannot undo: a later review changed this card.');
	}
	if (event.previous)
		await tx
			.objectStore('flashLearning')
			.put({ ...event.previous, revision: current.revision + 1 });
	else
		await tx
			.objectStore('flashLearning')
			.put({ id: current.id, revision: current.revision + 1, card: createEmptyCard() });
	const progress = await tx.objectStore('flashProgress').get(event.next.id);
	if (progress?.studiedAt === event.at) {
		if (event.previousProgress) await tx.objectStore('flashProgress').put(event.previousProgress);
		else await tx.objectStore('flashProgress').delete(event.next.id);
	}
	await tx.objectStore('flashReviews').put({ ...event, undone: true });
	await tx.done;
}
