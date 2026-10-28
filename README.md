# Think Fast

A private, local-first training instrument for rapid mental arithmetic and arrow-pattern
recognition. There are no accounts, external APIs, analytics, cookies, or server-side data. All
practice history lives in IndexedDB and can be moved through versioned JSON backups.

## Stack

- SvelteKit and Svelte 5 runes with strict TypeScript
- Tailwind CSS v4
- IndexedDB through `idb`
- Zod backup validation
- Static output through `@sveltejs/adapter-static`
- Vitest unit tests and Playwright browser tests
- Bun for dependency management and every project command

## Local development

```sh
bun install
bun run dev
```

The production output is a client-rendered static application. Fixed routes are prerendered;
local deck pages (`/flashcards/[deck_id]`) and study pages (`/flashcards/[deck_id]/study`)
load through the generated `200.html` fallback. Configure static hosting to serve `200.html`
for paths that do not match an existing file so direct links and reloads work:

```sh
bun run build
bun run preview
```

## Validation

```sh
bun run format
bun run check
bun run lint
bun run test
bunx playwright install chromium # once per machine
bun run test:e2e
bun run build
```

## Data behavior

IndexedDB is the authoritative automatic save. Attempts and an updated interrupted-session
checkpoint are written together after every response. A hidden tab pauses countdown, session,
and response timing, so background time is excluded.

JSON export is deliberately user-initiated. When changes have not been exported, Think Fast
registers the browser's generic `beforeunload` warning. Browsers do not allow custom leave text or
a reliable download after a tab has already closed.

Backup imports are validated before IndexedDB changes, previewed, and then replaced or merged in a
single transaction. Reset deletes the complete Think Fast IndexedDB database only after explicit
confirmation.
