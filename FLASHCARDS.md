# Flashcards architecture and implementation plan

Status: implementation prompt and proposed design. Editing this document does not authorize implementation; do not change application code until implementation is explicitly requested.

## Implementation brief and priority

When implementation is requested, build this feature inside the existing Think Fast app. Inspect the current repository before choosing abstractions. Use Svelte 5 runes, strict TypeScript, Tailwind v4, `idb`, Zod, and Bun; preserve static deployment, local-first storage, existing training modes, and existing user data. Match the app's current visual language and responsive layout.

The following are required for a complete first release; none may be deferred behind optional Anki-replacement features:

1. Import decks from CSV and supported Anki `.apkg` packages, with preview, validation, useful errors, and safe cancellation.
2. Export a selected deck as CSV or versioned JSON from the interface. A ZIP backup alone does not satisfy either export requirement.
3. Create a deck from scratch in the interface, add/edit cards, and immediately study it without importing a file or configuring a profile.
4. Provide a discoverable Flashcards navigation entry and an all-decks library with search, counts, and create/import/study/edit/export actions.
5. Persist and display the current user's progress separately for each deck, including after reload, editing, and supported reimports.
6. Keep navigation, editing, study, import, and export responsive at representative library sizes. Meet and report the performance budgets below.

Implement these as complete user journeys with loading, empty, success, failure, and recovery states. Use one default local profile automatically; additional profile management, advanced analytics, offline installation, and Anki scheduling migration must not block these journeys. The detailed architecture below supports the longer-term direction, but does not expand the first-release gate to every later feature.

Before implementation, verify the chosen Anki parser and scheduler against their primary documentation and actual fixtures; document supported formats and limitations rather than promising universal Anki compatibility. At delivery, report completed requirements, verification results, measured performance, and any remaining limitations.

## 1. What we are building

A local-first flashcard section that can become a practical replacement for Anki. Users can import Anki decks, create and edit cards, attach media, practice randomly or with spaced repetition, and inspect their progress. Core features work without accounts or a backend database.

Decisions already agreed:

- Every deck has a permanent UUID.
- Every deck also has a SHA-256 content hash identifying its current content version.
- Support CSV and Anki `.apkg` imports, plus CSV and JSON deck exports.
- Provide deck/card editing, media editing, study UI, random practice, FSRS, profiles, history, and statistics.

Recommended defaults:

- Extend the existing IndexedDB database through `idb`.
- Keep deck content separate from each profile's learning state.
- Use an existing FSRS implementation behind an adapter.
- Treat random practice as a separate mode that does not change FSRS schedules.
- Provide portable backups containing both structured data and media.
- Add offline app caching so the interface can launch without a connection after installation/caching.

## 2. Storage: IndexedDB or SQLite?

| Choice                            | Benefits                                                                                 | Costs                                                                                  | Recommendation                                |
| --------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| IndexedDB through existing `idb`  | Already in this app; native browser persistence; indexes, transactions, and binary blobs | No SQL joins or built-in full-text search; relationships enforced by application logic | Use for the first implementation              |
| SQLite WASM with OPFS persistence | SQL, relational queries, and potential full-text search                                  | More initialization, worker, persistence, browser compatibility, and concurrency work  | Reconsider if measured query needs justify it |
| Desktop app with native SQLite    | Strong file/database integration and SQL                                                 | Requires packaging and maintaining a desktop application                               | Possible later distribution option            |

IndexedDB is a real local database, but it does not speak SQL and requires no server. It supports indexed structured records and files/blobs. See [MDN's IndexedDB documentation](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API).

SQLite in a browser is also possible without a server. Its persistence and locking requirements depend on the selected implementation; validate the target browsers and hosting requirements before committing to it. See [SQLite WASM persistence](https://www.sqlite.org/wasm/doc/trunk/persistence.md).

Keep storage operations behind repository interfaces: fetch a study queue, save a review, search notes, import a deck, and load media. Components should not directly open IndexedDB transactions or issue SQL. This preserves the option to change storage later without pretending that a migration would be free.

Reading SQLite data inside an Anki package does not require using SQLite as the application's permanent storage engine.

## 3. Data model

### Content and identity

| Entity                | Key                                | Main information                                                                              |
| --------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| Deck                  | UUID                               | Name, description, parent deck, content hash, hash format version, timestamps, archive status |
| Note type             | UUID                               | Field definitions, supported type, template definitions, styling                              |
| Note                  | UUID                               | Note type, field values, tags, content revision, timestamps                                   |
| Card template         | Stable UUID within a note type     | Front/back rendering instructions and supported behavior                                      |
| Card                  | UUID                               | Note ID, template ID or cloze identifier, deck ID, timestamps, archive status                 |
| Media                 | SHA-256 of original bytes          | Blob, MIME type, byte length, dimensions/duration where available                             |
| Media reference       | Owner ID + field/template location | Media hash, original filename, alt text/caption                                               |
| Import source mapping | Source namespace + source identity | Corresponding local IDs, original Anki IDs/GUIDs, last imported content fingerprint           |
| Deck revision         | UUID                               | Deck ID, content hash, parent revision, timestamp, import/edit origin                         |

A note is the editable source information. Cards are the questions generated from it:

- Basic: one front/back question.
- Basic and reversed: two questions from the same note, one in each direction.
- Cloze: one or more questions produced by hiding selected parts of a passage.

Each generated card has independent learning state. Editing a shared note updates all its cards. The editor must make this relationship visible. See [Anki's note and card concepts](https://docs.ankiweb.net/manual/getting-started).

Cards belong to decks. Notes may produce cards in different decks, so do not assume a note always has exactly one deck. Initial editing can place all generated cards together while the model supports imported differences.

### Profiles and learning

| Entity              | Key                                         | Main information                                                                                                             |
| ------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Profile             | UUID                                        | Display name, optional avatar, timezone, study-day cutoff, preferences                                                       |
| Deck study settings | Profile ID + deck ID                        | Daily limits, new-card ordering, scheduler settings, retention target, inherited overrides                                   |
| Card learning state | Profile ID + card ID                        | New/learning/review/relearning state, due time, FSRS state, repetitions, lapses, suspension, bury-until time, revision       |
| Review event        | UUID                                        | Profile/card/session IDs, timestamp, mode, rating, active duration, scheduler version/settings snapshot, previous/next state |
| Study session       | UUID                                        | Profile, selected decks/filters, mode, start/end, active time, checkpoint, shuffle seed/order when relevant                  |
| Daily statistics    | Profile ID + study date, optionally deck ID | Derived counts and totals; rebuildable from events                                                                           |
| Import job          | UUID                                        | Source fingerprint, status, staged generation, counts, warnings, completion time                                             |

Deck content is shared within the local library; learning progress is per profile. Editing shared content affects every profile using it. A user who wants separate content should duplicate the deck with new IDs.

Local profiles are conveniences, not secure accounts. They do not isolate data from another person with access to the same browser storage. No email or password is required.

Record historical deck ID and content revision with each review so moving or editing a card does not silently rewrite historical attribution. Imported history may lack some fields; retain provenance and mark unavailable values instead of inventing them.

## 4. UUIDs, hashes, and updates

### Permanent identity

Generate deck, note, card, profile, and event UUIDs locally. Preserve IDs in native backups and exports. Renaming a deck or fixing a typo must not create a new identity or reset progress.

Preserve source Anki identifiers in a separate mapping. Do not assume an Anki numeric ID is globally unique across unrelated collections. An import into an existing deck should retain its source namespace; conflicting or ambiguous matches need an import preview decision.

### Deck content hash

Use SHA-256 over a versioned canonical content manifest:

- Include deck name/description, note fields, tags, card membership, supported templates/styles, and hashes of referenced media.
- Exclude personal progress, review history, study settings, timestamps, import filenames, and the hash itself.
- Exclude locally assigned UUID values from content equivalence; resolve relationships into stable content representations.
- Sort unordered collections deterministically, preserve meaningful field/template order, and retain duplicate counts.
- Define Unicode/line-ending handling explicitly; do not normalize away meaningful HTML or whitespace.
- For a deck with subdecks, include their names and content hashes; edits invalidate ancestor hashes too.
- Include the canonicalization format version so future changes are distinguishable from content edits.

A hash identifies equivalent content under these rules, not ownership, access rights, or a download location. It is not a replacement for the deck UUID. Never auto-merge intentionally separate decks just because their hashes match.

Maintain a separate raw file hash to detect an identical `.apkg` being imported again. Different exports of equivalent content may have different raw file hashes.

Recompute affected content fingerprints after an edit, preferably in a worker. Review events never trigger deck rehashing. Export must wait until the content hash matches the committed content revision.

### Edit behavior

- Ordinary field/style edits retain card IDs and learning state.
- Adding a reverse template or new cloze creates new cards.
- Removing a template/cloze archives obsolete cards rather than silently deleting their history.
- Explicit reset-learning actions clear/reinitialize the selected profile's learning state with a recorded reset event.
- Cloze renumbering or template replacement may make identity ambiguous; preview affected cards before applying destructive changes.
- Duplicating a deck produces new deck/note/card IDs while reusing media blobs. Progress is excluded by default.

## 5. Efficient IndexedDB access

Extend the existing database with flashcard stores and migrate it without removing arithmetic/pattern data.

Important indexes:

- Decks by parent ID.
- Cards by deck ID and note ID.
- Notes by note type and tags.
- Learning state by profile, eligibility/state, and due time; add a deck-aware queue index or maintained projection if profiling warrants it.
- Reviews by profile/time, profile/card/time, and session ID.
- Sessions by profile/start time.
- Import mappings by source namespace and source identity.

Use cursor pagination and bounded queries. Fetch media only when needed. Do not load the full library, all history, or every media blob into the global Svelte state at startup.

For text search, maintain a normalized search projection and add a worker-built token index if benchmarks require it. IndexedDB indexes alone do not provide general substring/full-text search.

Save a rating, updated learning state, and session checkpoint in one transaction. Use a unique event ID and expected state revision to prevent double submissions and stale writes from another tab. Coordinate active sessions across tabs and handle database version-change events cleanly.

Do parsing, decompression, hashing, and unrelated asynchronous work before opening short write transactions. Chunk large import staging writes and activate the completed generation atomically so canceled/failed imports never appear as partial decks.

## 6. Anki `.apkg` import

Anki deck packages can contain decks, notes, note types/templates, cards, and optional media and scheduling data. Export settings determine what is present. See [Anki export documentation](https://docs.ankiweb.net/manual/exporting).

### Import flow

1. Select or drop an `.apkg` file.
2. Detect the actual supported package format, not just its filename extension.
3. Parse the archive and embedded collection in a worker, using format-appropriate decompression/readers.
4. Extract decks, notes, templates, cards, tags, source identities, media, and available history.
5. Convert to a normalized staging representation and validate relationships.
6. Show a preview: deck tree, counts, media size, unsupported features, duplicate matches, and history availability.
7. Choose import as new, update an existing imported deck, or cancel. For personal data, choose fresh learning or supported progress migration.
8. Validate capacity, commit staged data, and show a report with skipped items and warnings.

Cancellation and failure must preserve the existing library. Bound decompressed size, file count, and individual media size; detect corrupt packages and unsafe archive paths. Limits should be configurable and benchmarked, not inherited from the existing 10 MB JSON backup limit.

### Compatibility target

| Feature                                   | Initial target                                                   |
| ----------------------------------------- | ---------------------------------------------------------------- |
| Basic and reversed notes                  | Supported                                                        |
| Standard cloze                            | Supported                                                        |
| Deck hierarchy and tags                   | Supported                                                        |
| Images and audio                          | Supported, subject to browser playback support                   |
| Common field substitutions and formatting | Supported subset, documented                                     |
| Complex custom templates and scripts      | Preview warnings; no arbitrary script execution                  |
| Image occlusion                           | Later dedicated support; identify unsupported imports explicitly |
| Existing scheduling/history               | Separate migration milestone; never silently approximate         |
| Anki add-ons and AnkiWeb sync             | Not part of package compatibility                                |

Use isolated/sanitized rendering for imported content. Remote resources should not load automatically; show missing local media clearly. Validate a real fixture library covering legacy and modern packages before declaring either format supported.

On reimport, compare source identity and last imported content. Preserve local-only edits and review history. If local and incoming content both changed, show a conflict choice. Do not remove absent cards unless the update is known to be a complete authoritative deck and deletion is explicitly selected.

Import history and scheduling separately: preserving review logs does not guarantee exact Anki scheduling parity. Version/configuration differences require a documented mapping or a clear fresh-start option. Native backups must round-trip all app state even before Anki round-trip export is supported.

### CSV import contract

- Accept UTF-8 CSV with optional BOM, quoted delimiters, escaped quotes, embedded newlines, Unicode, and CRLF/LF endings. Use a tested parser; never split rows or fields naively.
- Default to a header row with `front,back`; provide a header/no-header choice, delimiter selection (comma, semicolon, or tab), and column mapping for other files. Required mappings are front and back; optional mappings are deck path, tags, and stable source ID. Ignore extra columns only after showing that choice in the preview.
- One row creates one basic note/card by default. The user chooses a new deck name or an existing destination. An optional mapped deck path may create subdecks when explicitly enabled.
- Preview mapped cards and valid/invalid/duplicate counts before writing. Report row numbers and actionable errors for missing fields, malformed quoting, and invalid mappings. Preserve meaningful whitespace and treat imported fields as plain text by default; HTML requires explicit selection and sanitization.
- Allow correction/cancel or explicit import of valid rows with a skipped-row report. Never silently drop invalid rows. Empty files and files with no valid cards must not create a misleading successful import.
- CSV has no inherent identity: stable source IDs may support updates within a known source namespace, but text similarity alone must not overwrite cards. Preview exact duplicates and allow skip or keep; preserve existing progress and local edits during explicit updates.
- Use the same staged import, quota handling, worker processing, and cancellation guarantees as `.apkg`. CSV does not import Anki scheduling or history.

### CSV and JSON deck export contract

- Provide an Export action in the library and deck detail with explicit CSV/JSON selection, subdeck scope, and a content-only default. Export must work for manually created, CSV-imported, and Anki-imported decks.
- CSV is a portable flattened view: one generated card per row with headers `deck,card_id,note_id,note_type,front,back,tags`. Specify deterministic tag encoding (a JSON array in one quoted cell), stable ordering, and UTF-8/quoting rules. Export cloze/reversed cards as their individual question/answer views; explain that CSV cannot preserve editable templates, scheduling, or binary attachments. Media references need a warning, not silently missing content.
- Protect CSV opened in spreadsheets from formula execution in user-controlled cells. Document the reversible escaping convention and honor it when reimporting this app's exports, without changing stored card text. Test formula-like input and ordinary punctuation.
- JSON is a standalone, versioned deck document with an explicit format identifier, export timestamp, deck hierarchy, IDs, content hashes, notes, templates, cards, tags, and a media manifest. For a self-contained export, include referenced media bytes once per hash using documented encoding; validate sizes and process large exports off the main thread. Do not export live object URLs.
- Offer an explicit JSON option to include the active profile's learning state and review history for the selected deck scope; omit other profiles and unrelated training data. Preserve all referenced records needed to interpret that scope. Clearly distinguish deck export from a full-app backup.
- Support restoring this app's deck JSON through a validated preview/import path so structured content and optional progress can round-trip. Reject unknown versions and broken references safely; provide new-copy versus identity-preserving restore/update semantics without silently overwriting progress.
- Export a consistent committed revision, show progress/cancellation for large jobs, clean up temporary resources, and leave stored content unchanged on failure. CSV/JSON deck export must not mark unrelated app data as fully backed up or clear the global backup reminder incorrectly.

## 7. Choosing the next card

Separate queue selection from scheduling. Queue selection decides what to show now; scheduling decides how a rating changes the card's future due date.

| Mode            | Next-card behavior                                                                       | Effect on long-term schedule       |
| --------------- | ---------------------------------------------------------------------------------------- | ---------------------------------- |
| Random practice | Shuffle eligible selected cards without replacement; offer another pass after completion | None by default                    |
| FSRS review     | Select eligible due/learning cards and permitted new cards using explicit queue policy   | Ratings update FSRS learning state |

Use a scheduler adapter around a pinned [TS-FSRS](https://github.com/open-spaced-repetition/ts-fsrs) version. Record scheduler version and configuration with reviews. Parameter training can come later; the library's default parameters are the initial starting point.

FSRS mode needs more than the scheduling formula:

- Again / Hard / Good / Easy, with predicted intervals visible after reveal.
- Explicit new-card and daily-review limits, including parent-deck behavior.
- Defined learning/relearning steps and interleaving with due reviews.
- Sibling burying to avoid immediately exposing another card from the same note.
- Suspend and bury controls; a buried card returns after the configured study-day boundary.
- An agreed policy for overdue cards and cards becoming due during a session.
- Undo that restores previous learning state and marks the review undone, keeping statistics consistent.
- One injected clock and deterministic test settings for reproducible scheduling tests.

Random mode records practice events and time but remains separate in statistics. If scheduled learning during random order is later desired, expose it as an explicit mode with clear semantics.

Changing the selected mode does not reset FSRS progress. Scheduler upgrades require an explicit migration policy, not automatic rewriting of historical reviews.

## 8. Screens and interaction

### Flashcard library

- All-decks tree/list, including manually created and imported decks, with name, total active cards, new/learning/review counts, due count, last studied, and per-deck progress for the active profile. Keep archived decks behind a visible filter.
- Empty library offers equally clear Create deck and Import CSV / Anki actions. Search/filter/sort the library without loading every card; paginate or virtualize large lists. Keep navigation and key actions usable on mobile.
- Search, create, import, rename, move, archive, duplicate, and export.
- Deck detail with description, card count, recent activity, study settings, and practice action.
- Distinguish total overdue work from today's limited queue.

### Create a deck from scratch

- Create deck asks for a name and optional description, then opens the new empty deck with an Add card action. No import, account, profile setup, template configuration, or media attachment is required.
- Start with front/back fields and a rendered preview; support basic/reversed/cloze as described below. Validate required fields inline, retain failed-save drafts, and provide Save and add another with sensible keyboard focus.
- Show card count and save status immediately. Once at least one valid card is saved, Study is available. Reloading preserves the deck and cards; deleting the final card returns to a usable empty-deck state.
- Allow renaming and editing existing decks/cards through visible controls. Keep stable identities and progress through ordinary edits. Confirm destructive operations with their scope.

### Card browser and editor

- Paginated/virtualized list with search and filters for deck, tags, note type, due state, suspended state, and missing media.
- Split view: list on the left, editable note fields and rendered card previews on the right.
- Basic/reversed/cloze creation, tag editing, card moves, suspension, and bulk actions.
- Show all cards generated by a note before saving template/cloze changes.
- Autosave valid drafts with visible save status; explicit apply for changes that regenerate/remove cards.
- Rich text with constrained formatting; advanced template editing can follow later.

### Media editing

- Paste, drag/drop, or select images/audio; preview and remove attachments.
- Add alt text/captions and inspect filename/type/size.
- Store original files as blobs, not base64 strings embedded in every note.
- Deduplicate original bytes by SHA-256; keep thumbnails as separate derived assets.
- Replacing shared media changes the selected reference, not every use of the old blob.
- Delete unused blobs only after checking all content, revision, and backup/staging references.
- Release temporary object URLs; provide click-to-play when autoplay is blocked.

### Practice

- Choose decks/tags, mode, session limit, and eligible cards.
- Show prompt, reveal answer, then rate or advance according to mode.
- Keyboard shortcuts, touch controls, accessible labels, visible focus, and reduced motion.
- Edit current note, suspend, bury, flag, undo, and pause/end session.
- Persist after each action; recover interrupted sessions.
- Count active time only, following the existing app's hidden-tab pause behavior.
- End with a summary appropriate to the selected mode.

### Profile, history, and statistics

Required per-deck progress in the first release:

- Show studied coverage as unique active cards with at least one non-undone study event divided by total active cards, alongside the raw counts. Label this “Studied,” not mastery or completion; an empty deck shows 0 cards and no percentage.
- Show new, learning/relearning, review, and due counts, today's reviews, active study time, and last-study date on deck detail. Distinguish random practice from scheduled reviews and explain whether suspended/buried cards are included in each count.
- Parent summaries count each descendant card once; show direct versus inclusive scope clearly. Coverage follows current card membership; historical review totals retain their recorded deck attribution. Archived/deleted cards do not inflate active coverage.
- Persist progress by profile/card identity and derive per-deck summaries from indexed queries or maintained aggregates. Update summaries after rating, undo, reset, card moves, import, and archive without rescanning all reviews on every screen render.
- Adding new cards may reduce coverage; editing or renaming existing content must not reset it. Random practice contributes to studied coverage and practice time, while leaving scheduled state unchanged.

Additional history and statistics:

- Profile switcher with local name/avatar, timezone, day cutoff, and goals.
- Review history with deck/card/date/mode filters and a card-level timeline.
- Activity calendar, study time, ratings, new cards introduced, lapses, and due forecast.
- Report recall rate with a documented denominator: eligible scheduled reviews rated Hard/Good/Easy divided by eligible scheduled reviews, with Again counted as failed recall. Exclude undone events and separate learning steps/random practice.
- Distinguish observed recall from FSRS estimates and user-selected retention targets.
- Store timestamps in UTC plus the historical study-date/timezone context. Changing timezone should not silently move past activity to different days.
- Daily aggregates are caches; rebuild them after import, undo, or corrections.

## 9. Backups, durability, and offline operation

Use a versioned native ZIP package containing a manifest, structured records, and media files addressed by hash. Offer two exports:

- Share deck: content and media only.
- Full backup: profiles, settings, learning state, events, sessions, content, and media, alongside existing training data.

Keep old JSON backup imports supported. The current backup format and 10 MB cap are appropriate for the existing small records but need a new media-aware path. Do not silently export a backup that excludes flashcards while claiming to contain all data.

Validate references, versions, and media hashes before activation. Backups preserve UUIDs. Merge by identity with explicit conflict handling; restore/replace must clearly state its scope. Retain a recoverable pre-restore snapshot where capacity permits.

Request persistent browser storage, display storage usage/capacity estimates, handle quota errors without partial updates, and show last successful backup time. Browser storage still can be deleted by the user; local snapshots in the same origin are not an external backup. See [browser storage and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

Offline launch requires caching the app shell and required assets, including parser/scheduler dependencies as needed. IndexedDB alone does not make the website launch offline. Keep data migrations compatible with app update handling.

Cross-device synchronization is a later feature. UUIDs and event IDs prepare for it but do not solve conflicts, authentication, transport, or concurrent reviews by themselves.

## 10. Fit with the current repository

Proposed organization, not files to create in this planning step:

| Area                             | Responsibility                                                                |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `src/lib/flashcards/domain/`     | Entities, validation, card generation, canonical hashing, scheduler contracts |
| `src/lib/flashcards/data/`       | IndexedDB repositories, migrations, query projections                         |
| `src/lib/flashcards/services/`   | Import/export, editing operations, study sessions, statistics                 |
| `src/lib/flashcards/workers/`    | Package parsing, hashing, indexing, expensive processing                      |
| `src/lib/flashcards/components/` | Library, editor, rendering, study controls, media UI                          |
| `src/routes/flashcards/`         | Library and deck detail                                                       |
| `src/routes/flashcards/browse/`  | Search and editing                                                            |
| `src/routes/flashcards/study/`   | Practice setup and session                                                    |
| `src/routes/flashcards/stats/`   | History and statistics                                                        |

Extend navigation and settings/profile entry points. Reuse existing UI conventions and timing behavior, but do not force flashcard review events into arithmetic `AttemptRecord` correctness fields.

The current repository loads complete snapshots for its small datasets. Add bounded flashcard queries rather than extending that startup snapshot to include the entire library. Update database migrations, backup validation, recovery, and reset behavior together. Existing reset deletes the whole database; its UI must accurately communicate the expanded scope.

## 11. Delivery sequence and acceptance checks

### Phase 1: Native content and random practice

Build the schema, automatic default profile, UUID/hash rules, in-interface deck creation, basic/reversed/cloze editing, media, all-decks library, random practice, per-deck coverage/time, CSV import, CSV/JSON export and JSON restore, and native backup/restore.

Acceptance: edit and reload without losing data; shared notes generate correct cards; duplicate decks get new IDs; identical media is stored once; backup restores content/media/profiles; existing training data survives migration.

### Phase 2: FSRS and review history

Add scheduling, due queues, limits, bury/suspend, undo, interrupted sessions, and persisted per-deck review statistics visible in the library and deck detail.

Acceptance: rating commits atomically; undo restores state; concurrent stale ratings cannot overwrite newer state; random practice leaves schedules unchanged; due dates and study days behave correctly across timezone/daylight-saving boundaries.

### Phase 3: Anki import — required for the intended replacement

Add package parsing, compatibility preview, media mapping, identity preservation, duplicate/update handling, and cancellation. Deliver fresh-start import first, then supported progress/history migration.

Acceptance: fixture decks cover supported package versions, basic/reversed/cloze notes, nested decks, media, repeated imports, local-edit conflicts, corrupt files, and unsupported templates. Existing learning progress survives content updates.

### First-release gate (phases 1–3)

All six requirements in the implementation brief must work before calling the feature complete. Performance and data integrity are requirements throughout these phases, not work deferred to phase 4.

Verify these end-to-end journeys:

- Create an empty deck → add several cards → edit one → study → reload → verify cards and per-deck progress, with another deck's progress unchanged.
- Import CSV with quoted multiline/Unicode fields → preview mappings and invalid rows → commit → export CSV → reimport → verify supported text fidelity and explicit duplicate behavior.
- Import real supported legacy and modern `.apkg` fixtures → inspect deck hierarchy/basic/reversed/cloze/media → study → reimport/update → verify stable IDs and preserved local progress. Unsupported package variants must yield a clear actionable error rather than success with empty content.
- Export a manually created and an imported deck as JSON → restore in a clean library → verify content, media, IDs, and optionally included progress. Check CSV limitations are visible before export.
- Cancel or fail an import/export, simulate quota failure, undo a review, and reload an interrupted session → verify the library and existing training data remain consistent.
- Visit every deck from the library, including empty decks, nested decks, and enough decks to exercise pagination; verify counts and responsive keyboard/touch interaction.

Run focused Vitest and Playwright coverage for these behaviors, plus `bun run check`, `bun run lint`, `bun run test`, `bun run test:e2e`, and `bun run build`. Report failures honestly; do not claim compatibility or speed from mocked fixtures alone.

### Performance budgets and measurement

Use a production build and a reproducible fixture with 100 decks, 50,000 cards, and 1 million review events; include a separate media-heavy import. Record device, browser, fixture bytes, cold/warm cache state, and peak memory where measurable. Test a named desktop and a representative mobile device or documented throttled mobile profile.

Initial acceptance targets (measure p95 across repeated interactions):

- Warm library/deck navigation and first study-card readiness: at most 500 ms desktop / 1 s mobile.
- Reveal answer and visible response to a rating: at most 100 ms desktop / 200 ms mobile; commit the rating before accepting another and show a recoverable error if persistence fails.
- Search results after a 150–250 ms debounce: at most 300 ms desktop / 600 ms mobile, excluding the debounce.
- During import/export, visible feedback begins within 200 ms, progress updates at least once per second while work is active, cancellation is acknowledged within 500 ms, and no processing-induced main-thread task exceeds 100 ms. Clearly label stages with unknown total work.

Lazy-load archive/SQLite/scheduler dependencies only where needed. Preload a bounded next-card buffer, virtualize long card/deck lists, use indexed queues and incremental aggregates, and keep media out of startup queries. Do not build an entire archive, parsed database, normalized library, and base64 export as simultaneous in-memory copies. Bound memory with chunking/staging; document actual parser limits and supported file sizes using measurements. If a target cannot be met, report the measurement and cause and resolve it or explicitly agree a revised target before declaring completion.

### Phase 4: Reliability and scale

Add offline installation/update behavior, richer statistics, bulk editing, storage management, and recovery polish. Benchmark representative libraries, for example 50,000 cards and 1 million review events, on named desktop and mobile targets. Define measured latency/memory budgets before claiming scale support.

Acceptance: library startup does not read all content; search and due queries stay bounded; large imports keep the UI responsive; cancellation/quota failure leaves no visible partial deck; full backup restoration is verified.

### Later extensions

Image occlusion, advanced template support, Anki export, FSRS parameter optimization, optional sync, shared deck hosting, and possibly a desktop SQLite edition.

## 12. Decisions to revisit during implementation

- Exact browser/device support matrix and tested library sizes.
- Supported Anki package/template variants and progress migration coverage.
- Hash canonicalization fixtures and deck/subdeck export semantics.
- Import size limits and media codec support.
- Review/new-card default limits and study-day cutoff.
- Which bulk/template edits require confirmation because they remove generated cards.
- Whether measured full-text search/reporting needs justify SQLite later.

The first implementation should remain a static, local-first application. Its essential foundation is stable identity, separate content and learning state, atomic review writes, indexed queries, and complete portable backups.
