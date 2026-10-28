# Flashcards implementation status

This is a partial implementation of FLASHCARDS.md, not the complete first-release gate.

Implemented:

- IndexedDB version 4 migration preserving existing training stores.
- Discoverable library, creation, rename, basic front/back editing/deletion, search.
- Random practice and default-profile studied coverage.
- Pinned ts-fsrs 5.4.2 adapter, ratings and predicted due dates, transactional review/state writes, stale revision detection, undo.
- CSV parsing with Papa Parse, header/delimiter/column selection, validation preview, explicit invalid-row skipping, duplicate reporting.
- CSV export with apostrophe-v1 reversible spreadsheet escaping.
- Versioned JSON deck export, optional default-profile learning/history, new-copy import, identity restore/update retaining existing local progress.
- Legacy Anki SQLite package reader in a worker, bounded archive input and decompressed size, cancellation, explicit limited-format preview.
- Full-app JSON backup includes flashcards; older backup files remain readable.

Compatibility limits:

- Anki is experimental and has NOT been validated against a real legacy/modern fixture library. Only collection.anki2 and collection.anki21 SQLite containers are read. Modern compressed containers are rejected with re-export guidance.
- Anki fields are flattened as text; deck hierarchy, tags, media, arbitrary templates, source mapping, scheduling migration, and conflict-aware reimport are not implemented. Do not rely on imported output without inspecting it.
- Native editing supports basic cards only. Shared notes, reversed/cloze editing, media editing, profiles, archiving and bulk actions remain.
- FSRS queue currently uses up to 100 due/new cards per pass. Daily quotas, sibling burying, suspend, session recovery, active-time statistics and timezone/day-cutoff policies remain.
- Undo restores scheduler state and prior studied coverage unless a newer practice event changed coverage.
- Imports have a 20 MB file limit; decompressed Anki packages have a 100 MB limit. These are safety limits, not measured scale guarantees.
- Full backup is JSON rather than ZIP. Large-file streaming, worker-based CSV/JSON transfer and backup performance work remain.
- No 50,000-card / million-review benchmark has been completed. Library and deck queries still materialize their results and do not meet the specified bounded-query architecture.
- Offline installation, content hashes, revisions and complete recovery tooling remain.

Primary documentation consulted:

- https://github.com/open-spaced-repetition/ts-fsrs
- https://docs.ankiweb.net/manual/exporting
- https://sql.js.org/documentation/
- https://www.papaparse.com/docs

Verification:

- Type checking and production static build passed during development.
- 34 unit tests passed, including CSV multiline/Unicode/formula escaping and JSON reference validation.
- 14 Chromium end-to-end tests passed, including create/study/reload and cancel CSV preview. These do not validate every new operation.
