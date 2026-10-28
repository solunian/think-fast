<script lang="ts">
	import {
		exportCsv,
		exportJson,
		parseCsv,
		documentSchema,
		download
	} from '#lib/flashcards/transfer.js';
	import { onMount } from 'svelte';
	import * as repo from '#lib/flashcards/repository.js';
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
	let editing = $state<string | null>(null);
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
			library = await repo.decks();
			loading = false;
		});
	});
	async function open(deck: repo.Deck) {
		selected = deck;
		name = deck.name;
		description = deck.description;
		items = await repo.cards(deck.id);
		stats = await repo.summary(items);
		studied = await repo.coverage(items);
		practicing = false;
		editing = null;
		front = '';
		back = '';
	}
	async function create() {
		if (!name.trim()) throw new Error('Enter a deck name.');
		const deck = { id: crypto.randomUUID(), name: name.trim(), description };
		await repo.saveDeck(deck);
		library = await repo.decks();
		await open(deck);
	}
	async function save() {
		if (!selected) return;
		await repo.saveCard({ id: editing ?? crypto.randomUUID(), deckId: selected.id, front, back });
		items = await repo.cards(selected.id);
		editing = null;
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
			library = await repo.decks();
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
		library = await repo.decks();
		await open(deck);
	}
	async function rename() {
		if (!selected || !name.trim()) throw new Error('Enter a deck name.');
		selected = { ...selected, name: name.trim(), description };
		await repo.saveDeck(selected);
		library = await repo.decks();
	}
</script>

<svelte:head><title>Flashcards · Think Fast</title></svelte:head>
<main class="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
	<p class="eyebrow">Local training · Default profile</p>
	<h1 class="text-3xl font-bold">Flashcards</h1>
	<p class="muted">
		Create a deck, add questions, and practice at your own pace. Saved on this device.
	</p>
	{#if error}<p role="alert" class="surface p-4 text-[var(--danger)]">
			{error}
			<button
				onclick={() =>
					run(async () => {
						library = await repo.decks();
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
			}}>All decks</button
		>
		<section class="surface space-y-4 p-5">
			<h2 class="text-2xl font-bold">{selected.name}</h2>
			<details>
				<summary>Rename / description</summary>
				<label class="field"><span>Name</span><input class="input" bind:value={name} /></label>
				<label class="field"
					><span>Description</span><input class="input" bind:value={description} /></label
				>
				<button class="btn-secondary" disabled={busy} onclick={() => run(rename)}>Save deck</button>
			</details>
			<details>
				<summary>Export deck</summary>
				<p>
					CSV contains plain text cards only. Spreadsheet-sensitive text uses reversible apostrophe
					escaping. JSON preserves content IDs. Progress can optionally be included in JSON.
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
					><input type="checkbox" bind:checked={includeProgress} /> Include default profile progress and
					review history</label
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
		{#if practicing}
			<section class="surface space-y-5 p-6">
				{#if queue[0]}
					<p>{queue.length} remaining</p>
					<p class="whitespace-pre-wrap text-2xl">{queue[0].front}</p>
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
				{:else}<h2 class="text-xl font-bold">Practice complete</h2>
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
			<form
				class="surface space-y-3 p-5"
				onsubmit={(e) => {
					e.preventDefault();
					void run(save);
				}}
			>
				<h2 class="text-xl font-bold">{editing ? 'Edit card' : 'Add card'}</h2>
				{#if editing}<button
						type="button"
						class="btn-danger"
						disabled={busy}
						onclick={() =>
							run(async () => {
								if (
									editing &&
									confirm('Delete this card? Historical review records will be retained.')
								) {
									await repo.removeCard(editing);
									items = await repo.cards(selected!.id);
									editing = null;
									front = '';
									back = '';
									studied = await repo.coverage(items);
								}
							})}>Delete card</button
					>{/if}
				<label class="field"
					><span>Front</span><textarea class="input" bind:value={front} required></textarea></label
				>
				<label class="field"
					><span>Back</span><textarea class="input" bind:value={back} required></textarea></label
				>
				<button class="btn-primary" disabled={busy}>Save and add another</button>
			</form>
			<label class="field"
				><span>Search cards</span><input class="input" bind:value={search} /></label
			>
			{#each items
				.filter((c) => (c.front + ' ' + c.back).toLowerCase().includes(search.toLowerCase()))
				.slice(0, 100) as card (card.id)}
				<button
					class="surface block w-full p-4 text-left"
					onclick={() => {
						editing = card.id;
						front = card.front;
						back = card.back;
					}}>{card.front}<span class="muted float-right">Edit</span></button
				>
			{/each}
			{#if items.length > 100}<p>Showing up to 100 matches. Search to narrow results.</p>{/if}
		{/if}
	{:else}
		<form
			class="surface space-y-3 p-5"
			onsubmit={(e) => {
				e.preventDefault();
				void run(create);
			}}
		>
			<h2 class="text-xl font-bold">Create deck</h2>
			<label class="field"
				><span>Name</span><input class="input" bind:value={name} required /></label
			>
			<label class="field"
				><span>Description (optional)</span><input class="input" bind:value={description} /></label
			>
			<button class="btn-primary" disabled={busy}>Create deck</button>
		</form>
		<section class="surface space-y-3 p-5">
			<h2 class="text-xl font-bold">Import CSV / Anki / deck JSON</h2>
			<p class="muted">
				Anki: legacy packages only, plain text, fresh learning. Media and custom templates are not
				supported. Maximum file size: 20 MB.
			</p>
			{#if busy && ankiWorker}<button class="btn-secondary" onclick={() => cancelImport?.()}
					>Cancel parsing</button
				>{/if}
			<label class="field"
				><span>Delimiter</span><select class="input" bind:value={delimiter}
					><option value=",">Comma</option><option value=";">Semicolon</option><option value="&#9;"
						>Tab</option
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
				<h3 class="font-bold">Import preview</h3>
				{#if restore}<label
						><input type="checkbox" bind:checked={preserveIdentity} /> Restore original IDs and optional
						progress (existing local progress wins)</label
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
							><input type="checkbox" bind:checked={skipInvalid} /> Import valid rows and skip the reported
							errors</label
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
					>{preserveIdentity && restore ? 'Restore / update deck' : 'Import as new deck'}</button
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
		<label class="field"><span>Search decks</span><input class="input" bind:value={search} /></label
		>
		{#each library.filter((d) => d.name
				.toLowerCase()
				.includes(search.toLowerCase())) as deck (deck.id)}
			<button
				class="surface block w-full p-5 text-left"
				disabled={busy}
				onclick={() => run(() => open(deck))}
				><strong>{deck.name}</strong>
				<p class="muted">{deck.description}</p></button
			>
		{:else}<p>No decks found. Create your first deck above.</p>{/each}
	{/if}
</main>
