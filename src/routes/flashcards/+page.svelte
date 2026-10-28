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
	let name = $state('');
	let description = $state('');
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
			if (selected) stats = await repo.summary(items);
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
		queue = [...items];
		if (mode === 'scheduled') {
			const scheduler = await import('../../lib/flashcards/scheduler');
			const states = await Promise.all(queue.map((c) => scheduler.predictions(c.id)));
			queue = queue
				.filter(
					(_, i) => !states[i].state || new Date(states[i].state!.card.due).getTime() <= Date.now()
				)
				.slice(0, 100);
		}
		for (let i = queue.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[queue[i], queue[j]] = [queue[j], queue[i]];
		}
		sessionSize = queue.length;
		lastReview = undefined;
		practicing = true;
		revealed = false;
		await prepareSchedule();
	}
	async function next() {
		await repo.study(queue[0]);
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
		await refreshLibrary();
	}
</script>

<svelte:head><title>Flashcards · Think Fast</title></svelte:head>
<main class="flashcards mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
	<div class="page-heading">
		<div>
			<p class="eyebrow">YOUR PERSONAL STUDY SPACE</p>
			<h1 class="text-3xl font-medium">
				{practicing ? 'Practice' : selected ? 'Deck studio' : 'Flashcards'}
			</h1>
			<p class="muted">
				{practicing
					? 'One question at a time. Take a breath and focus.'
					: selected
						? 'Shape your knowledge, one card at a time.'
						: 'Small cards. Lasting knowledge. Pick a deck and keep going.'}
			</p>
		</div>
		{#if !selected}<button
				class="btn-primary"
				onclick={() => {
					creating = !creating;
					name = '';
					description = '';
				}}>+ Create deck</button
			>{/if}
	</div>
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
		<button
			class="btn-secondary"
			onclick={() => {
				selected = null;
				name = '';
				description = '';
				practicing = false;
				search = '';
				void run(refreshLibrary);
			}}>All decks</button
		>
		{#if !practicing}
			<section class="surface deck-overview space-y-4 p-6">
				<h2 class="text-2xl font-medium">{selected.name}</h2>
				<details>
					<summary>Rename / description</summary>
					<label class="field"><span>Name</span><input class="input" bind:value={name} /></label>
					<label class="field"
						><span>Description</span><input class="input" bind:value={description} /></label
					>
					<button class="btn-secondary" disabled={busy} onclick={() => run(rename)}
						>Save deck</button
					>
				</details>
				<details>
					<summary>Export deck</summary>
					<p>
						CSV contains plain text cards only. Spreadsheet-sensitive text uses reversible
						apostrophe escaping. JSON preserves content IDs. Progress can optionally be included in
						JSON.
					</p>
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
					<label
						><input type="checkbox" bind:checked={includeProgress} /> Include default profile progress
						and review history</label
					>
					<button class="btn-secondary" disabled={busy} onclick={() => run(downloadDeckJson)}
						>Export JSON</button
					>
				</details>
				<p>{selected.description}</p>
				<p>
					{items.length} cards · Studied {studied}/{items.length}{items.length
						? ' (' + Math.round((studied / items.length) * 100) + '%)'
						: ''}
				</p>
				{#if stats}<p>
						New {stats.new} · Learning {stats.learning} · Review {stats.review} · Due {stats.due}
					</p>
					<p>Last studied: {stats.last ? new Date(stats.last).toLocaleString() : 'Never'}</p>{/if}
				<label class="field"
					><span>Study mode</span><select class="input" bind:value={mode}
						><option value="random">Random practice</option><option value="scheduled"
							>FSRS review</option
						></select
					></label
				>
				<p class="muted">
					Random practice leaves schedules unchanged. FSRS selects up to 100 due or new cards per
					pass.
				</p>
				<button class="btn-primary" disabled={busy || !items.length} onclick={() => run(start)}
					>Study</button
				>
			</section>
		{/if}
		{#if practicing}
			<section class="surface practice-stage space-y-5 p-6 sm:p-10">
				<div class="practice-top">
					<span class="eyebrow">{selected.name}</span><span class="muted"
						>{mode === 'scheduled' ? 'Spaced repetition' : 'Random practice'}</span
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
					<p>{queue.length} remaining</p>
					<p class="practice-question whitespace-pre-wrap text-2xl">{queue[0].front}</p>
					{#if revealed}
						<p class="whitespace-pre-wrap border-t border-[var(--line)] pt-5">{queue[0].back}</p>
						{#if mode === 'scheduled'}
							{#each [1, 2, 3, 4] as grade (grade)}
								<button
									class="btn-primary"
									disabled={busy}
									onclick={() => run(() => rating(grade as 1 | 2 | 3 | 4))}
									>{['', 'Again', 'Hard', 'Good', 'Easy'][grade]} · {schedule
										? new Date(schedule.choices[grade as 1 | 2 | 3 | 4].card.due).toLocaleString()
										: ''}</button
								>
							{/each}
						{:else}<button class="btn-primary" disabled={busy} onclick={() => run(next)}
								>Next card</button
							>{/if}
					{:else}<button class="btn-primary" onclick={() => (revealed = true)}>Reveal answer</button
						>{/if}
				{:else}<h2 class="text-xl font-medium">Practice complete</h2>
					<button class="btn-secondary" onclick={() => run(start)}>Another pass</button>{/if}
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
	.practice-stage {
		max-width: 800px;
		margin: 2rem auto;
	}
	.practice-question {
		min-height: 180px;
		display: grid;
		place-content: center;
		text-align: center;
		overflow-wrap: anywhere;
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
</style>
