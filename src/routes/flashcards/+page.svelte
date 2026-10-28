<script lang="ts">
	import {
		exportCsv,
		exportJson,
		parseCsv,
		documentSchema,
		download
	} from '#lib/flashcards/transfer.js';
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import * as repo from '#lib/flashcards/repository.js';
	let creating = $state(false);
	let creationMode = $state<'empty' | 'import'>('empty');
	let sessionSize = $state(0);
	let deckStats = $state<
		Record<string, Awaited<ReturnType<typeof repo.summary>> & { count: number }>
	>({});
	async function refreshLibrary() {
		library = await repo.decks();
		deckStats = Object.fromEntries(
			await Promise.all(
				library.map(async (deck) => {
					const cards = await repo.cards(deck.id);
					return [deck.id, { ...(await repo.summary(cards)), count: cards.length }];
				})
			)
		);
		loading = false;
	}
	afterNavigate(() => {
		selected = null;
		practicing = false;
		creating = false;
		search = '';
		void run(refreshLibrary);
	});
	let mode = $state('random');
	const studyLabels = {
		new: 'New',
		learning: 'Learning',
		review: 'Review',
		memorized: 'Memorized'
	};
	let selectedStatuses = $state<repo.StudyStatus[]>(['new', 'learning', 'review', 'memorized']);
	let randomStatuses = $state<Record<string, repo.StudyStatus>>({});
	let scheduledStatuses = $state<Record<string, repo.StudyStatus>>({});
	const cardStatuses = $derived(mode === 'random' ? randomStatuses : scheduledStatuses);
	async function refreshStatuses() {
		[randomStatuses, scheduledStatuses] = await Promise.all([
			repo.studyStatuses(items, 'random'),
			repo.studyStatuses(items, 'scheduled')
		]);
	}

	let schedule =
		$state<Awaited<ReturnType<typeof import('../../lib/flashcards/scheduler').predictions>>>();
	let lastReview = $state<import('../../lib/flashcards/scheduler').Review>();
	async function prepareSchedule() {
		if (mode === 'scheduled' && queue[0])
			schedule = await (await import('../../lib/flashcards/scheduler')).predictions(queue[0].id);
	}
	async function rating(grade: 1 | 2 | 3 | 4) {
		const card = queue[0];
		if (!schedule) return;
		lastReview = await (
			await import('../../lib/flashcards/scheduler')
		).rate(card.id, card.deckId, grade, schedule.state?.revision ?? 0);
		queue = queue.slice(1);
		revealed = false;
		studied = await repo.coverage(items);
		await prepareSchedule();
	}
	let library = $state<repo.Deck[]>([]);
	let selected = $state<repo.Deck | null>(null);
	let items = $state<repo.Card[]>([]);
	const statusCounts = $derived({
		new: items.filter((card) => (cardStatuses[card.id] ?? 'new') === 'new').length,
		learning: items.filter((card) => cardStatuses[card.id] === 'learning').length,
		review: items.filter((card) => cardStatuses[card.id] === 'review').length,
		memorized: items.filter((card) => cardStatuses[card.id] === 'memorized').length
	});
	const matchingCards = $derived(
		items.filter((card) => selectedStatuses.includes(cardStatuses[card.id] ?? 'new')).length
	);

	let name = $state('');
	let description = $state('');
	let editingDetails = $state(false);
	let front = $state('');
	let back = $state('');

	let search = $state('');
	let studied = $state(0);
	let stats = $state<Awaited<ReturnType<typeof repo.summary>>>();
	let cancelImport: (() => void) | undefined;
	let busy = $state(false);
	let error = $state('');
	let queue = $state<repo.Card[]>([]);
	let practicing = $state(false);
	let revealed = $state(false);
	let previousCards = $state<repo.Card[]>([]);
	function previous() {
		const card = previousCards.at(-1);
		if (!card || busy) return;
		previousCards = previousCards.slice(0, -1);
		queue = [card, ...queue];
		revealed = false;
	}
	function practiceKey(event: KeyboardEvent) {
		if (!practicing || busy || event.repeat || event.altKey || event.ctrlKey || event.metaKey)
			return;
		if (
			event.target instanceof HTMLElement &&
			event.target.closest('input, textarea, select, [contenteditable="true"]')
		)
			return;
		if (event.code === 'Space' && queue[0]) {
			event.preventDefault();
			revealed = !revealed;
		} else if (mode === 'random' && event.key === 'ArrowLeft') {
			event.preventDefault();
			previous();
		} else if (mode === 'random' && event.key === 'ArrowRight' && queue[0]) {
			event.preventDefault();
			void run(next);
		} else if (mode === 'scheduled' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
			const buttons = Array.from(
				document.querySelectorAll<HTMLButtonElement>('.rating-controls button')
			);
			if (!buttons.length) return;
			event.preventDefault();
			const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
			buttons[
				(index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1) + buttons.length) %
					buttons.length
			].focus();
		}
	}
	let loading = $state(true);
	async function run(action: () => Promise<void>) {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await action();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			if (selected) {
				stats = await repo.summary(items);
				await refreshStatuses();
			}
			busy = false;
		}
	}
	onMount(() => {
		void run(async () => {
			await refreshLibrary();
			loading = false;
		});
	});
	async function open(deck: repo.Deck) {
		selected = deck;
		editingDetails = false;
		selectedStatuses = ['new', 'learning', 'review', 'memorized'];
		creating = false;
		search = '';
		name = deck.name;
		description = deck.description;
		items = await repo.cards(deck.id);
		stats = await repo.summary(items);
		studied = await repo.coverage(items);
		practicing = false;
		front = '';
		back = '';
	}
	async function create() {
		if (!name.trim()) throw new Error('Enter a deck name.');
		const deck = { id: crypto.randomUUID(), name: name.trim(), description };
		await repo.saveDeck(deck);
		await refreshLibrary();
		await open(deck);
	}
	async function save() {
		if (!selected) return;
		await repo.saveCard({ id: crypto.randomUUID(), deckId: selected.id, front, back });
		items = await repo.cards(selected.id);
		front = '';
		back = '';
	}
	async function start() {
		await refreshStatuses();
		queue = items.filter((card) => selectedStatuses.includes(cardStatuses[card.id]));
		if (!queue.length) throw new Error('Choose a label with cards to start studying.');

		for (let i = queue.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[queue[i], queue[j]] = [queue[j], queue[i]];
		}
		sessionSize = queue.length;
		previousCards = [];
		lastReview = undefined;
		practicing = true;
		revealed = false;
		await prepareSchedule();
	}
	async function next(status?: Exclude<repo.StudyStatus, 'new'>) {
		await repo.study(queue[0], status);
		previousCards = [...previousCards, queue[0]];
		queue = queue.slice(1);
		revealed = false;
		studied = await repo.coverage(items);
	}
	let ankiWorker = $state<Worker | null>(null);
	let ankiWarnings = $state<string[]>([]);
	let preserveIdentity = $state(false);
	let includeProgress = $state(false);
	async function downloadDeckJson() {
		if (selected)
			download(
				exportJson(
					selected,
					items,
					includeProgress ? await repo.deckProgress(selected.id) : undefined
				),
				selected.name + '.json',
				'application/json'
			);
	}
	let importText = $state('');
	let importName = $state('');
	let delimiter = $state(',');
	let header = $state(true);
	let frontColumn = $state(0);
	let backColumn = $state(1);
	let preview = $state<ReturnType<typeof parseCsv> | null>(null);
	let restore = $state<ReturnType<typeof documentSchema.parse> | null>(null);
	let skipInvalid = $state(false);
	async function readFile(file: File | undefined) {
		if (!file) return;
		if (file.size > 20 * 1024 * 1024) throw new Error('Import limit is 20 MB.');
		preview = null;
		restore = null;
		importName = file.name.replace(/\.[^.]+$/, '');
		if (file.name.endsWith('.apkg')) {
			ankiWorker = new Worker(new URL('../../lib/flashcards/anki.worker.ts', import.meta.url), {
				type: 'module'
			});
			const worker = ankiWorker;
			try {
				const result = await new Promise<{
					cards: { front: string; back: string }[];
					warnings: string[];
				}>((resolve, reject) => {
					cancelImport = () => {
						worker.terminate();
						reject(new Error('Import canceled. No data was changed.'));
					};
					worker.onmessage = (e) =>
						e.data.error ? reject(new Error(e.data.error)) : resolve(e.data);
					worker.onerror = () => reject(new Error('Anki parser failed.'));
					file
						.arrayBuffer()
						.then((data) => worker.postMessage(data, [data]))
						.catch(reject);
				});
				preview = { cards: result.cards, errors: [], headers: [], duplicates: 0 };
				ankiWarnings = result.warnings;
			} finally {
				worker.terminate();
				ankiWorker = null;
				cancelImport = undefined;
			}
			return;
		}
		ankiWarnings = [];
		importText = await file.text();
		if (file.name.endsWith('.json')) restore = documentSchema.parse(JSON.parse(importText));
		else preview = parseCsv(importText, delimiter, header, frontColumn, backColumn);
	}
	async function commitImport() {
		if (restore && preserveIdentity) {
			if (
				library.some((d) => d.id === restore!.deck.id) &&
				!confirm('Update this existing deck’s content? Existing local progress will be kept.')
			)
				return;
			await repo.restoreDocument(restore);
			await refreshLibrary();
			await open(restore.deck);
			restore = null;
			preview = null;
			return;
		}
		const deck = restore
			? { ...restore.deck, id: crypto.randomUUID() }
			: { id: crypto.randomUUID(), name: importName.trim(), description: '' };
		if (!deck.name) throw new Error('Enter a destination deck name.');
		const source = restore?.cards ?? preview?.cards ?? [];
		if (!source.length) throw new Error('No valid cards to import.');
		await repo.importCards(
			deck,
			source.map((c) => ({
				id: crypto.randomUUID(),
				deckId: deck.id,
				front: c.front,
				back: c.back
			}))
		);
		preview = null;
		restore = null;
		importText = '';
		await refreshLibrary();
		await open(deck);
	}
	async function rename() {
		if (!selected || !name.trim()) throw new Error('Enter a deck name.');
		selected = { ...selected, name: name.trim(), description };
		await repo.saveDeck(selected);
		editingDetails = false;
		await refreshLibrary();
	}
</script>

<svelte:window onkeydown={practiceKey} />

<svelte:head><title>Flashcards · Think Fast</title></svelte:head>
<main class:practicing class="flashcards mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
	{#if !practicing && !selected}
		<div class="page-heading">
			<div>
				<h1 class="text-3xl font-medium">Flashcards</h1>
				<p class="muted">Choose a deck to review.</p>
			</div>
			<button
				class="btn-primary"
				onclick={() => {
					creating = !creating;
					name = '';
					description = '';
				}}>+ Create deck</button
			>
		</div>
	{/if}
	{#if error}<p role="alert" class="surface p-4 text-[var(--danger)]">
			{error}
			<button
				onclick={() =>
					run(async () => {
						await refreshLibrary();
						loading = false;
					})}>Retry loading</button
			>
		</p>{/if}
	{#if loading}<p role="status">Loading decks…</p>{/if}
	{#if selected}
		{#if !practicing}<button
				class="btn-secondary"
				onclick={() => {
					selected = null;
					name = '';
					description = '';
					practicing = false;
					search = '';
					void run(refreshLibrary);
				}}>← All decks</button
			>
		{/if}
		{#if !practicing}
			<section class="surface deck-overview" aria-label="Deck overview">
				<div class="deck-heading">
					<div class="deck-title">
						<h1>{selected.name}</h1>
						{#if selected.description}<p class="muted">{selected.description}</p>{/if}
					</div>
					<button
						class="btn-secondary"
						aria-expanded={editingDetails}
						onclick={() => {
							name = selected!.name;
							description = selected!.description;
							editingDetails = !editingDetails;
						}}>Edit details</button
					>
				</div>
				{#if editingDetails}
					<form
						class="deck-details-form"
						onsubmit={(e) => {
							e.preventDefault();
							void run(rename);
						}}
					>
						<label class="field"
							><span>Deck name</span><input
								class="input"
								bind:value={name}
								required
								placeholder="Give your deck a name"
							/></label
						>
						<label class="field"
							><span>Description <span class="muted">(optional)</span></span><textarea
								class="input"
								bind:value={description}
								rows="3"
								placeholder="What will you learn with this deck?"></textarea></label
						>
						<div class="detail-actions">
							<button class="btn-primary" disabled={busy || !name.trim()}>Save changes</button>
							<button
								type="button"
								class="btn-quiet"
								disabled={busy}
								onclick={() => (editingDetails = false)}>Cancel</button
							>
						</div>
					</form>
				{/if}
				<div class="deck-statistics">
					<dl class="stat-grid" aria-label="Deck statistics">
						<div>
							<dt>Total cards</dt>
							<dd>{items.length}</dd>
						</div>
						<div>
							<dt>New</dt>
							<dd>{statusCounts.new}</dd>
						</div>
						<div>
							<dt>Learning</dt>
							<dd>{statusCounts.learning}</dd>
						</div>
						<div>
							<dt>Review</dt>
							<dd>{statusCounts.review}</dd>
						</div>
						<div class="memorized-stat">
							<dt>Memorized</dt>
							<dd>{statusCounts.memorized}</dd>
						</div>
					</dl>
					<div class="coverage-row">
						<div class="coverage-meter">
							<div class="coverage-label">
								<span>Studied <strong>{studied} / {items.length}</strong></span><span
									>{items.length ? Math.round((studied / items.length) * 100) : 0}%</span
								>
							</div>
							<progress max={items.length || 1} value={studied} aria-label="Cards studied"
							></progress>
						</div>
						<p class="last-studied muted">
							Last studied <span
								>{stats?.last ? new Date(stats.last).toLocaleString() : 'Never'}</span
							>
						</p>
					</div>
				</div>
				<fieldset class="study-filters">
					<legend>Cards to study</legend>
					<div class="filter-options">
						{#each Object.entries(studyLabels) as [status, label]}
							<label
								class="status-filter"
								class:active={selectedStatuses.includes(status as repo.StudyStatus)}
							>
								<input type="checkbox" value={status} bind:group={selectedStatuses} />
								<span>{label}</span><span class="filter-count"
									>{items.filter((card) => (cardStatuses[card.id] ?? 'new') === status)
										.length}</span
								>
							</label>
						{/each}
					</div>
					<p class="muted">
						{matchingCards}
						{matchingCards === 1 ? 'card matches' : 'cards match'} · {mode === 'random'
							? 'Label cards as you practice to organize your next session.'
							: 'All matching cards are included. Memorized cards have a review interval of at least 21 days.'}
					</p>
				</fieldset>
				<div class="study-toolbar">
					<div class="study-setup">
						<label class="field"
							><span>Study mode</span><select
								class="input"
								bind:value={mode}
								aria-describedby="study-mode-help"
								><option value="random">Random practice</option><option value="scheduled"
									>FSRS review</option
								></select
							></label
						>
						<p class="muted" id="study-mode-help">
							{mode === 'random'
								? 'Shuffle the cards matching your labels.'
								: 'Review all matching cards. Your ratings update their schedules.'}
						</p>
					</div>
					<div class="study-start">
						{#if mode === 'scheduled'}<p class="muted text-sm">{stats?.due ?? 0} due now</p>{/if}
						<button class="btn-primary" disabled={busy || !matchingCards} onclick={() => run(start)}
							>Study</button
						>
					</div>
				</div>

				<details class="deck-export">
					<summary>Export deck</summary>
					<div class="export-options">
						<div>
							<p class="font-medium">CSV</p>
							<p class="muted text-sm">Plain text cards for spreadsheets and other apps.</p>
							<button
								class="btn-secondary"
								onclick={() => {
									if (selected)
										download(
											exportCsv(selected, items),
											selected.name + '.csv',
											'text/csv;charset=utf-8'
										);
								}}>Export CSV</button
							>
						</div>
						<div>
							<p class="font-medium">JSON</p>
							<p class="muted text-sm">Keep card IDs and optionally include your progress.</p>
							<label class="progress-option"
								><input type="checkbox" bind:checked={includeProgress} /> Include progress and review
								history</label
							><button class="btn-secondary" disabled={busy} onclick={() => run(downloadDeckJson)}
								>Export JSON</button
							>
						</div>
					</div>
				</details>
			</section>
		{/if}
		{#if practicing}
			<section class="surface practice-stage">
				<div class="practice-top">
					<span class="eyebrow">{selected.name}</span><span class="muted"
						>{queue.length} remaining</span
					>
				</div>
				<progress
					max={sessionSize || 1}
					value={sessionSize - queue.length}
					aria-label="Practice progress"
				></progress>
				<p class="muted">
					{items.length} cards · Studied {studied}/{items.length}{items.length
						? ' (' + Math.round((studied / items.length) * 100) + '%)'
						: ''}
				</p>
				{#if queue[0]}
					<button
						class="flashcard"
						aria-label={revealed ? 'Show question' : 'Reveal answer'}
						aria-pressed={revealed}
						onclick={() => (revealed = !revealed)}
					>
						<span class="eyebrow">{revealed ? 'Answer' : 'Question'}</span>
						<span class="card-content">{revealed ? queue[0].back : queue[0].front}</span>
						<span class="muted text-sm">Click card or press Space to flip</span>
					</button>
				{:else}<div class="practice-complete">
						<h2 class="text-xl font-medium">Practice complete</h2>
					</div>{/if}
				<footer class="practice-controls">
					{#if mode === 'random'}
						{#if queue[0] && revealed}
							<div class="random-labels" role="group" aria-label="Label this card">
								<p class="muted text-sm">Choose a label to save and continue</p>
								<div class="random-label-buttons">
									{#each ['learning', 'review', 'memorized'] as status}
										<button
											class="btn-secondary"
											disabled={busy}
											onclick={() => run(() => next(status as Exclude<repo.StudyStatus, 'new'>))}
											>{studyLabels[status as repo.StudyStatus]}</button
										>
									{/each}
								</div>
							</div>
						{/if}
						<div class="card-navigation">
							<button
								class="btn-secondary"
								disabled={busy || !previousCards.length}
								onclick={previous}>← Previous card</button
							>
							{#if queue[0]}<button class="btn-secondary" onclick={() => (revealed = !revealed)}
									>Flip card · Space</button
								>
								<button class="btn-primary" disabled={busy} onclick={() => run(next)}
									>Next card →</button
								>{/if}
						</div>
						<p class="muted text-sm">← / → Previous / next card · Space to flip</p>
					{:else if queue[0]}
						<div class="rating-controls" class:rating-grid={revealed}>
							{#if revealed}
								{#each [1, 2, 3, 4] as grade (grade)}
									<button
										class="rating-button"
										disabled={busy}
										onclick={() => run(() => rating(grade as 1 | 2 | 3 | 4))}
									>
										<strong>{['', 'Again', 'Hard', 'Good', 'Easy'][grade]}</strong>
										<span
											>{[
												'',
												'I couldn’t recall it.',
												'I remembered with effort.',
												'I remembered correctly.',
												'I knew it right away.'
											][grade]}</span
										>
									</button>
								{/each}
							{:else}<button class="btn-primary" onclick={() => (revealed = true)}
									>Reveal answer</button
								>{/if}
						</div>
						<p class="muted text-sm">← / → Select rating · Enter to rate · Space to flip</p>
					{/if}
					<div class="practice-exit">
						{#if !queue.length}<button
								class="btn-secondary"
								disabled={busy}
								onclick={() => run(start)}>Another pass</button
							>{/if}
						{#if lastReview}<button
								class="btn-secondary"
								disabled={busy}
								onclick={() =>
									run(async () => {
										if (lastReview) {
											await (await import('../../lib/flashcards/scheduler')).undo(lastReview);
											lastReview = undefined;
											studied = await repo.coverage(items);
											await prepareSchedule();
										}
									})}>Undo last rating</button
							>{/if}
						<button class="btn-quiet" onclick={() => (practicing = false)}>End practice</button>
					</div>
				</footer>
			</section>
		{:else}
			<div class="page-heading">
				<div>
					<h2 class="text-xl font-medium">Cards <span class="muted">/ {items.length}</span></h2>
					<p class="muted">Edit a card in place, or add something new.</p>
				</div>
				<label class="field"
					><span>Search cards</span><input
						class="input"
						placeholder="Find a question or answer…"
						bind:value={search}
					/></label
				>
			</div>
			<div class="card-grid">
				<form
					class="surface card-tile new-card space-y-3"
					onsubmit={(e) => {
						e.preventDefault();
						void run(save);
					}}
				>
					<p class="eyebrow">+ NEW CARD</p>
					<label class="field"
						><span>Front</span><textarea
							class="input"
							placeholder="Write a question…"
							bind:value={front}
							required></textarea></label
					>
					<label class="field"
						><span>Back</span><textarea
							class="input"
							placeholder="Add the answer…"
							bind:value={back}
							required></textarea></label
					>
					<button class="btn-primary" disabled={busy}>Save and add another</button>
				</form>
				{#each items
					.filter((c) => (c.front + ' ' + c.back).toLowerCase().includes(search.toLowerCase()))
					.slice(0, 100) as card (card.id)}
					<form
						class="surface card-tile space-y-3"
						onsubmit={(e) => {
							e.preventDefault();
							void run(async () => {
								await repo.saveCard({ ...card });
								items = await repo.cards(selected!.id);
							});
						}}
					>
						<p class="eyebrow">QUESTION & ANSWER</p>
						<label class="field"
							><span>Front</span><textarea class="input" bind:value={card.front} required
							></textarea></label
						>
						<label class="field"
							><span>Back</span><textarea class="input" bind:value={card.back} required
							></textarea></label
						>
						<div class="tile-actions">
							<button class="btn-secondary" disabled={busy}>Save card</button><button
								type="button"
								class="btn-quiet"
								disabled={busy}
								onclick={() =>
									run(async () => {
										if (confirm('Delete this card? Historical review records will be retained.')) {
											await repo.removeCard(card.id);
											items = await repo.cards(selected!.id);
											studied = await repo.coverage(items);
										}
									})}>Delete card</button
							>
						</div>
					</form>
				{/each}
			</div>
			{#if items.length > 100}<p class="muted">
					Showing up to 100 matches. Search to narrow results.
				</p>{/if}
		{/if}
	{:else}
		{#if creating}
			<section class="surface creation-panel space-y-5 p-6">
				<div class="page-heading">
					<div>
						<p class="eyebrow">BUILD YOUR COLLECTION</p>
						<h2 class="text-2xl font-medium">Create a deck</h2>
					</div>
					<button class="btn-quiet" onclick={() => (creating = false)}>Close</button>
				</div>
				<div class="creation-tabs">
					<button class:active={creationMode === 'empty'} onclick={() => (creationMode = 'empty')}
						>Start from scratch</button
					><button
						class:active={creationMode === 'import'}
						onclick={() => (creationMode = 'import')}>Import a deck</button
					>
				</div>
				{#if creationMode === 'empty'}
					<form
						class="surface space-y-3 p-5"
						onsubmit={(e) => {
							e.preventDefault();
							void run(create);
						}}
					>
						<h2 class="text-xl font-medium">Create deck</h2>
						<label class="field"
							><span>Name</span><input class="input" bind:value={name} required /></label
						>
						<label class="field"
							><span>Description (optional)</span><input
								class="input"
								bind:value={description}
							/></label
						>
						<button class="btn-primary" disabled={busy}>Create deck</button>
					</form>
				{:else}
					<section class="space-y-3">
						<h2 class="text-xl font-medium">Import CSV / Anki / deck JSON</h2>
						<p class="muted">
							Anki: legacy packages only, plain text, fresh learning. Media and custom templates are
							not supported. Maximum file size: 20 MB.
						</p>
						{#if busy && ankiWorker}<button class="btn-secondary" onclick={() => cancelImport?.()}
								>Cancel parsing</button
							>{/if}
						<label class="field"
							><span>Delimiter</span><select class="input" bind:value={delimiter}
								><option value=",">Comma</option><option value=";">Semicolon</option><option
									value="&#9;">Tab</option
								></select
							></label
						>
						<label><input type="checkbox" bind:checked={header} /> First row is a header</label>
						<label class="field"
							><span>Front column (zero-based)</span><input
								type="number"
								min="0"
								class="input"
								bind:value={frontColumn}
							/></label
						>
						<label class="field"
							><span>Back column (zero-based)</span><input
								type="number"
								min="0"
								class="input"
								bind:value={backColumn}
							/></label
						>
						<input
							aria-label="Import file"
							type="file"
							accept=".csv,.tsv,.json,.apkg"
							disabled={busy}
							onchange={(e) => run(() => readFile(e.currentTarget.files?.[0]))}
						/>
						{#each ankiWarnings as warning, i (i)}<p role="status">{warning}</p>{/each}
						{#if preview || restore}
							<h3 class="font-medium">Import preview</h3>
							{#if restore}<label
									><input type="checkbox" bind:checked={preserveIdentity} /> Restore original IDs and
									optional progress (existing local progress wins)</label
								>{/if}
							<p>Existing decks and progress will be preserved. Extra CSV columns are ignored.</p>
							<label class="field"
								><span>New deck name</span><input class="input" bind:value={importName} /></label
							>
							{#if preview}
								<button
									class="btn-secondary"
									onclick={() =>
										(preview = parseCsv(importText, delimiter, header, frontColumn, backColumn))}
									>Apply column mapping</button
								>
								<p>
									{preview.cards.length} valid cards · {preview.duplicates} exact duplicate rows (kept)
								</p>
								{#each preview.errors as message, i (i)}<p class="text-[var(--danger)]">
										{message}
									</p>{/each}
								{#if preview.errors.length}<label
										><input type="checkbox" bind:checked={skipInvalid} /> Import valid rows and skip the
										reported errors</label
									>{/if}
							{/if}
							{#each (restore?.cards ?? preview?.cards ?? []).slice(0, 5) as card, i (i)}<p
									class="whitespace-pre-wrap"
								>
									{card.front} → {card.back}
								</p>{/each}
							<button
								class="btn-primary"
								disabled={busy || (!!preview?.errors.length && !skipInvalid)}
								onclick={() => run(commitImport)}
								>{preserveIdentity && restore
									? 'Restore / update deck'
									: 'Import as new deck'}</button
							>
							<button
								class="btn-secondary"
								disabled={busy}
								onclick={() => {
									preview = null;
									restore = null;
									importText = '';
								}}>Cancel</button
							>
						{/if}
					</section>
				{/if}
			</section>
		{/if}
		<div class="page-heading">
			<h2 class="text-xl font-medium">Your decks <span class="muted">/ {library.length}</span></h2>
			<p class="muted">Saved on this device · Default profile</p>
		</div>
		<label class="field"><span>Search decks</span><input class="input" bind:value={search} /></label
		>
		<div class="deck-grid">
			{#each library.filter((d) => (d.name + ' ' + d.description)
					.toLowerCase()
					.includes(search.toLowerCase())) as deck (deck.id)}
				<button class="surface deck-tile" disabled={busy} onclick={() => run(() => open(deck))}>
					<div class="tile-actions">
						<span class="deck-icon" aria-hidden="true">▤</span><span class="badge"
							>{deckStats[deck.id]?.due ?? 0} due</span
						>
					</div>
					<h3 class="text-xl font-medium">{deck.name}</h3>
					<p class="muted deck-description">
						{deck.description || 'A fresh space for everything you want to remember.'}
					</p>
					<div class="deck-numbers">
						<div><strong>{deckStats[deck.id]?.count ?? 0}</strong><span>Cards</span></div>
						<div><strong>{deckStats[deck.id]?.new ?? 0}</strong><span>New</span></div>
						<div><strong>{deckStats[deck.id]?.studied ?? 0}</strong><span>Studied</span></div>
					</div>
					<p class="muted text-sm">
						Last studied: {deckStats[deck.id]?.last
							? new Date(deckStats[deck.id].last).toLocaleDateString()
							: 'Not yet'}
					</p>
					<span class="deck-link">Open deck <span aria-hidden="true">↗</span></span>
				</button>
			{:else}<div class="surface empty-state">
					<h3 class="text-xl font-medium">
						{search ? 'No matching decks' : 'Your next learning habit starts here'}
					</h3>
					<p class="muted">
						{search
							? 'Try another search.'
							: 'Create your first deck from scratch or import cards you already have.'}
					</p>
					<button class="btn-secondary" onclick={() => (creating = true)}>Create a deck</button>
				</div>{/each}
		</div>
	{/if}
</main>

<style>
	.deck-overview {
		padding: clamp(1.25rem, 3vw, 2rem);
	}
	.deck-heading {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}
	.deck-title {
		min-width: 0;
	}
	.deck-title h1 {
		font-size: clamp(1.6rem, 3vw, 2rem);
		font-weight: 500;
		letter-spacing: -0.04em;
		overflow-wrap: anywhere;
	}
	.deck-title p {
		margin-top: 0.4rem;
		max-width: 42rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.deck-heading > button {
		flex-shrink: 0;
	}
	.deck-details-form {
		display: grid;
		gap: 1rem;
		margin-top: 1.5rem;
		padding: 1.25rem;
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		background: var(--surface-muted);
	}
	.deck-details-form textarea {
		resize: vertical;
	}
	.detail-actions {
		display: flex;
		gap: 0.5rem;
	}
	.deck-statistics {
		margin-block: 1.75rem;
	}
	.stat-grid {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 0.75rem;
	}
	.stat-grid > div {
		display: flex;
		flex-direction: column-reverse;
		gap: 0.15rem;
		padding: 1rem 1.25rem;
		border-radius: 0.75rem;
		background: var(--surface-muted);
	}
	.stat-grid dt {
		color: var(--muted);
		font-size: 0.8rem;
	}
	.stat-grid dd {
		font-size: 1.75rem;
		font-weight: 500;
		letter-spacing: -0.04em;
	}
	.stat-grid .memorized-stat {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.coverage-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 2rem;
		margin-top: 1.25rem;
		font-size: 0.8rem;
	}
	.coverage-meter {
		flex: 1;
		max-width: 28rem;
	}
	.coverage-label {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.25rem;
		color: var(--muted);
	}
	.coverage-label strong {
		color: var(--ink);
		font-weight: 500;
		margin-left: 0.4rem;
	}
	.last-studied {
		text-align: right;
	}
	.last-studied span {
		display: block;
		color: var(--ink);
	}
	.study-toolbar {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1.5rem;
		padding-block: 1.25rem;
		border-top: 1px solid var(--line);
	}
	.study-setup {
		display: flex;
		align-items: flex-end;
		gap: 1rem;
	}
	.study-setup select {
		min-width: 12rem;
	}
	.study-setup p {
		font-size: 1rem;
		line-height: 1.5;
		padding-block: 0.65rem;
		max-width: 24rem;
	}
	.study-start {
		min-width: 7rem;
	}
	.study-filters {
		border: 0;
		padding: 0 0 1.25rem;
		min-width: 0;
	}
	.study-filters legend {
		font-size: 0.85rem;
		font-weight: 500;
		margin-bottom: 0.65rem;
	}
	.filter-options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.status-filter {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		border: 1px solid var(--line);
		border-radius: 0.65rem;
		padding: 0.5rem 0.75rem;
		cursor: pointer;
	}
	.status-filter.active {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.status-filter input {
		accent-color: var(--accent);
		width: 1rem;
		height: 1rem;
	}
	.filter-count {
		color: var(--muted);
		font-size: 0.85rem;
	}
	.study-filters > p {
		font-size: 0.85rem;
		margin-top: 0.75rem;
	}
	.study-start {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.4rem;
		text-align: center;
	}
	.export-options {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 2rem;
		padding-top: 1rem;
	}
	.export-options button {
		margin-top: 0.75rem;
	}
	.progress-option {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.8rem;
		margin-top: 0.5rem;
	}
	@media (max-width: 640px) {
		.deck-heading {
			flex-wrap: wrap;
		}
		.stat-grid {
			grid-template-columns: repeat(3, 1fr);
			gap: 0.5rem;
		}
		.stat-grid > div {
			padding: 0.75rem;
		}
		.coverage-row {
			align-items: stretch;
			flex-direction: column;
			gap: 0.75rem;
		}
		.coverage-meter {
			max-width: none;
		}
		.last-studied {
			text-align: left;
		}
		.last-studied span {
			display: inline;
			margin-left: 0.4rem;
		}
		.study-setup {
			flex: 1;
			flex-direction: column;
			align-items: stretch;
			gap: 0.5rem;
		}
		.study-toolbar {
			align-items: flex-start;
		}
		.study-start {
			margin-top: 1.7rem;
			min-width: auto;
		}
		.export-options {
			grid-template-columns: 1fr;
			gap: 1.5rem;
		}
	}

	.page-heading,
	.tile-actions,
	.practice-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.page-heading h1 {
		margin: 0.3rem 0;
	}
	.deck-grid,
	.card-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
		gap: 1.25rem;
	}
	.deck-tile {
		padding: 1.5rem;
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		transition:
			transform 0.18s,
			border-color 0.18s;
	}
	.deck-tile:hover {
		transform: translateY(-3px);
		border-color: var(--accent);
	}
	.deck-icon {
		background: var(--accent-soft);
		color: var(--accent);
		border-radius: 12px;
		padding: 0.25rem 0.8rem;
		font-size: 1.8rem;
	}
	.badge {
		border-radius: 99px;
		background: var(--surface-muted);
		padding: 0.25rem 0.7rem;
		font-size: 0.75rem;
	}
	.deck-description {
		min-height: 3.2em;
		overflow-wrap: anywhere;
	}
	.deck-numbers {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		border-block: 1px solid var(--line);
		padding: 1rem 0;
	}
	.deck-numbers strong {
		display: block;
		font-size: 1.4rem;
		font-weight: 500;
	}
	.deck-numbers span {
		color: var(--muted);
		font-size: 0.8rem;
	}
	.deck-link {
		display: flex;
		justify-content: space-between;
		color: var(--accent);
		font-weight: 600;
		margin-top: auto;
	}
	.creation-panel {
		border-color: var(--accent);
	}
	.creation-tabs {
		display: flex;
		gap: 0.5rem;
		padding: 0.35rem;
		background: var(--surface-muted);
		border-radius: 12px;
	}
	.creation-tabs button {
		flex: 1;
		padding: 0.65rem;
		border-radius: 8px;
	}
	.creation-tabs .active {
		background: var(--surface);
		color: var(--accent);
		box-shadow: 0 2px 6px #0000000a;
	}
	.card-tile {
		padding: 1.4rem;
	}
	.card-tile textarea {
		min-height: 110px;
		resize: vertical;
	}
	.new-card {
		border-style: dashed;
		background: var(--accent-soft);
	}
	.empty-state {
		grid-column: 1/-1;
		padding: 3rem 1.5rem;
		text-align: center;
	}
	.empty-state p {
		margin: 0.75rem 0 1.5rem;
	}
	progress {
		width: 100%;
		height: 6px;
		accent-color: var(--accent);
	}
	details {
		border-top: 1px solid var(--line);
		padding-top: 0.75rem;
	}
	summary {
		cursor: pointer;
		color: var(--muted);
	}

	.practicing {
		position: fixed;
		inset: 0;
		z-index: 30;
		height: 100dvh;
		max-width: none;
		margin: 0;
		padding: clamp(0.5rem, 2vh, 1.5rem);
		background: var(--bg, var(--surface));
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.practicing > :global(*) {
		margin-block: 0;
	}
	.practice-stage {
		width: 100%;
		max-width: 64rem;
		margin: auto;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: clamp(1rem, 3vw, 2rem);
	}
	.practice-top,
	.card-navigation,
	.rating-controls,
	.practice-exit {
		display: flex;
		justify-content: center;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.rating-controls.rating-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.75rem;
	}
	.rating-button {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		padding: 0.85rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 0.75rem;
	}
	.rating-button:hover {
		background: var(--surface-muted);
		border-color: var(--accent);
	}
	.rating-button strong {
		font-size: 1rem;
		font-weight: 600;
	}
	.rating-button span {
		color: var(--muted);
		font-size: 0.85rem;
		line-height: 1.4;
	}
	.random-label-buttons {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.4rem;
	}
	@media (max-width: 640px) {
		.rating-controls.rating-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 0.5rem;
		}
		.rating-button {
			padding: 0.6rem;
		}
	}
	.practice-top {
		justify-content: space-between;
	}
	progress {
		width: 100%;
		height: 0.35rem;
	}
	.flashcard {
		flex: 1;
		min-height: 0;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		cursor: pointer;
		overflow: auto;
	}
	.flashcard:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.card-content {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: clamp(1.25rem, 3vw, 2rem);
		text-align: center;
		flex-shrink: 0;
		max-width: 100%;
	}
	.practice-complete {
		flex: 1;
		display: grid;
		place-items: center;
	}
	.practice-controls {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		text-align: center;
	}
	@media (max-height: 500px) {
		.practice-stage {
			gap: 0.25rem;
			padding: 0.5rem;
		}
		.flashcard {
			gap: 0.25rem;
		}
	}
</style>
