Build a complete, polished local-first web application named “Think Fast” in the current repository.

You are authorized to create and modify all project files, install dependencies with Bun, and run relevant local validation. Do not deploy the application or connect it to external services.

Before implementing:

1. Inspect the repository and preserve any relevant existing work.
2. Create a concise implementation plan.
3. Consult current Svelte 5 and SvelteKit documentation where needed.
4. If an important product requirement is genuinely ambiguous, make the smallest reasonable assumption and document it instead of stopping unnecessarily.

## Core stack

Use:

- Bun as the only package manager and command runner
- SvelteKit
- Svelte 5 with runes
- TypeScript in strict mode
- Tailwind CSS v4 for styling
- IndexedDB for persistent browser data
- A small IndexedDB wrapper such as `idb`, unless native IndexedDB is clearly simpler
- Zod for backup-file validation
- `@sveltejs/adapter-static` so the app can be deployed as a static site
- Vitest for unit tests
- Playwright for a small set of critical browser tests

Do not use:

- A cloud database
- Authentication or user accounts
- Supabase, Neon, Firebase, or other hosted storage
- Server-side persistence
- External APIs
- Analytics or tracking services
- Cookies for application data
- `localStorage` for practice history
- Copied proprietary interview questions or branding

The completed application must work entirely in the browser after its static assets have loaded.

## Product goal

Think Fast is a focused training application for:

1. Rapid mental arithmetic inspired by quantitative-trading interview arithmetic tests.
2. Timed visual pattern recognition involving matching arrow directions.
3. Tracking personal accuracy, response time, practice time, and improvement by exercise and category.
4. Keeping all progress private and stored locally in the browser.
5. Allowing the user to export and restore all progress and settings using a plain JSON backup file.

The experience should feel like a serious practice instrument rather than a generic SaaS dashboard or children’s math game.

## Initial application flow

When the application first initializes, check IndexedDB before rendering the main experience.

If valid existing browser data is present:

- Load it automatically.
- Go directly to the dashboard.
- Do not make the user click a “continue” button.
- Show a subtle confirmation such as “Local progress loaded.”
- Keep an Import Backup action available in Settings.

If no browser data is present:

- Show a focused welcome screen.
- Explain clearly that progress remains on this device unless exported.
- Present two actions:
  - “Import progress file”
  - “Start fresh”
- Make importing a previous Think Fast JSON file easy.
- Starting fresh should initialize default settings and open the dashboard.

If IndexedDB contains invalid or partially corrupted data:

- Do not crash.
- Show a recovery screen.
- Allow the user to export the recoverable raw data, reset local data, or import a valid backup.
- Never silently delete user data.

Do not add an account or login screen.

## Local persistence

Create a versioned IndexedDB data layer with clear TypeScript types and migrations.

Suggested stores:

### settings

Include:

- theme: light, dark, or system
- sound enabled
- reduced feedback animation preference
- default mental-math duration
- default pattern duration
- mental-math difficulty
- pattern difficulty
- last selected exercise
- backup metadata
- schema version

### sessions

Each completed or interrupted session should include:

- stable UUID
- exercise type
- category or mode
- start timestamp as ISO 8601
- end timestamp as ISO 8601
- active duration in integer milliseconds
- configured duration in integer milliseconds
- attempted count
- correct count
- incorrect count
- skipped count if skipping is supported
- average response time
- median response time
- completion reason: timer expired, target reached, user ended, or interrupted
- difficulty
- relevant exercise configuration

### attempts

Each attempt should include:

- stable UUID
- session ID
- exercise type
- problem category
- prompt representation sufficient to review the attempt
- submitted answer or selected choice
- expected answer
- correctness
- response time in integer milliseconds
- difficulty
- timestamp
- optional metadata specific to the exercise

### app metadata

Track:

- schema version
- created timestamp
- last modified timestamp
- last successful file-export timestamp
- whether meaningful changes have occurred since the last backup export

Save settings immediately after changes. Save attempts during a session and finalize the session atomically when possible. An accidental refresh should lose as little progress as reasonably possible.

Keep browser-only APIs out of SSR execution. Use appropriate SvelteKit browser checks and client lifecycle behavior.

## JSON backup and restore

Implement a complete, versioned JSON backup format.

A backup should resemble:

{
"format": "think-fast-backup",
"version": 1,
"exportedAt": "ISO timestamp",
"appVersion": "application version",
"settings": {},
"sessions": [],
"attempts": []
}

Requirements:

- Export all settings, sessions, attempts, and required metadata.
- Never export browser internals, secrets, object URLs, or transient UI state.
- Download using a filename such as:
  `think-fast-backup-2026-08-31T183000.json`
- Use a Blob and a user-initiated download.
- Validate imported files with Zod before changing IndexedDB.
- Reject unrelated JSON files and unsupported future schema versions gracefully.
- Set a reasonable maximum import size.
- Show an import preview with:
  - backup date
  - number of sessions
  - number of attempts
  - covered date range
- Offer:
  - “Replace local data”
  - “Merge with local data”
  - “Cancel”
- Require explicit confirmation before replacing data.
- Merge by stable IDs and avoid duplicate sessions or attempts.
- Perform imports transactionally so a failed import does not leave partial data.
- Mark a successful export only after the browser download has been initiated successfully.
- Include a readable error message for malformed backups.
- Provide a separate CSV statistics export if it can be implemented cleanly, but JSON restore support is mandatory.

Add an obvious “Export backup” action to:

- Settings
- Session results
- Any persistent backup reminder

## Closing-tab and backup behavior

Implement this honestly within browser platform limitations.

Browsers do not permit a reliable custom save dialog, custom close-warning text, or asynchronous file download after the user has already closed the tab.

Therefore:

- IndexedDB is the authoritative automatic local save.
- Track whether meaningful data changed since the last JSON export.
- When unexported changes exist, register a `beforeunload` handler that triggers the browser’s native generic leave confirmation.
- Do not register the handler when there are no unexported changes.
- Do not claim that the user’s JSON file was saved automatically.
- Show a persistent but unobtrusive “Backup recommended” indicator when changes have not been exported.
- On session completion, make “Export backup” readily available without blocking the results.
- If the user cancels the native leave confirmation and remains on the page, the existing backup action should be immediately visible.
- Continue automatically saving all progress to IndexedDB regardless of file-export status.

Also offer a clear explanation:

“Your progress is saved in this browser. Export a backup to move it to another browser or protect it if site data is cleared.”

## Exercise 1: Rapid Mental Math

Create a quick arithmetic exercise inspired by trading-interview speed tests, but do not copy proprietary question banks or use Optiver branding.

Default challenge:

- 8-minute countdown
- Target of 80 questions
- Session ends when time expires or 80 questions are completed
- Three-second 3–2–1 countdown before timing starts
- Timer displays minutes, seconds, and a clear progress indicator
- Timer must be based on monotonic elapsed time using `performance.now()`
- Do not implement the timer by merely decrementing a number every second
- Correct elapsed time after tab throttling or brief loss of focus
- Automatically pause when the document becomes hidden, or clearly choose and document a consistent alternative
- Paused time must not count as active practice time

Question categories:

- Two- and three-digit addition
- Two- and three-digit subtraction
- One- and two-digit multiplication
- Exact integer division
- Simple percentages
- Simple fractions and proportional reasoning
- Mixed arithmetic

Generator requirements:

- Generate questions locally.
- Ensure division problems have exact integer answers.
- Avoid accidental ambiguity.
- Avoid unreasonable values at lower difficulty.
- Avoid immediate duplicate questions.
- Include deterministic generator functions that can be unit tested with seeded randomness.
- Provide easy, standard, and hard difficulty settings.
- Let difficulty change operand ranges and operation complexity.
- Keep all expected answers exact; do not require floating-point tolerance in the initial version.

Interaction:

- Keep the answer field focused.
- Submit with Enter.
- Support keyboard-only operation.
- Do not require clicking between questions.
- Briefly indicate correct or incorrect without delaying the next question excessively.
- Record response time from the moment a question is shown until submission.
- Prevent double submission.
- Display question number, remaining time, and current accuracy without overwhelming the user.
- Allow the user to end a session deliberately with confirmation.
- Treat unanswered current questions correctly when time expires.
- Do not show the answer before submission.

Results should include:

- Score
- Attempted and correct counts
- Accuracy
- Average and median response time
- Active practice time
- Breakdown by arithmetic category
- Fastest correct response
- Comparison with the user’s recent local sessions when sufficient data exists
- Review of incorrect answers

## Exercise 2: Arrow Pattern Recognition

Create a timed “same or different” pattern-recognition exercise based on matching arrow directions.

Mechanic:

- Show two arrow grids side by side.
- Each grid contains arrows pointing up, down, left, or right.
- Ask whether every corresponding arrow direction matches.
- Some trials should match exactly.
- Other trials should contain one or more directional mismatches.
- Balance matching and non-matching trials.
- Avoid predictable answer sequences.
- Use native SVG or CSS-rendered arrows, not downloaded images.
- Make arrow direction unmistakable and accessible.
- Do not rely on color alone.

Default challenge:

- 2-minute countdown
- Three-second countdown before starting
- Respond using:
  - Left Arrow or `D` for “Different”
  - Right Arrow or `S` for “Same”
- Also provide large accessible on-screen buttons.
- Show the next pattern immediately after an answer.
- Measure reaction time with `performance.now()`.
- End when the timer expires.
- Pause or otherwise handle hidden tabs consistently with Mental Math.

Difficulty:

- Easy: 2×2 grids
- Standard: 3×3 grids
- Hard: 4×4 grids with more subtle mismatch placement
- At least one mismatch must exist for every “Different” trial.
- Avoid mismatches that are visually obscured or clipped.
- Generate patterns locally using testable pure functions.

Results should include:

- Attempted count
- Correct count
- Accuracy
- Average and median reaction time
- Same-versus-different accuracy
- Active practice time
- Recent local-session comparison
- Review of missed patterns using a compact readable representation

## Dashboard and statistics

The dashboard should prioritize starting practice quickly.

Include:

- Mental Math start action
- Arrow Patterns start action
- Total active practice time
- Overall accuracy
- Number of completed sessions
- Current locally calculated practice streak
- Recent sessions
- Performance by exercise
- Performance by mental-math category
- Average response-time trend
- Accuracy trend
- Empty states that explain what will appear after practicing

Allow filters for:

- Exercise
- Category
- Date range
- Difficulty

All calculations must happen locally. Do not transmit anything.

Use sensible handling for:

- No sessions
- One session
- Interrupted sessions
- Attempts without a finalized session
- Division by zero in statistics
- Missing historical fields from older schema versions

## Routes and organization

Use a clean SvelteKit structure. A reasonable route organization is:

- `/` — initialization, onboarding, or dashboard
- `/practice/math` — mental-math configuration and session
- `/practice/patterns` — arrow-pattern configuration and session
- `/history` — sessions and statistics
- `/settings` — preferences, import, export, and data reset

Organize reusable code under `src/lib`, including:

- IndexedDB repository
- Backup/import service
- Timer utility
- Statistics functions
- Math generator
- Pattern generator
- Shared domain types
- Reusable accessible UI components

Keep exercise generation, scoring, persistence, and statistics as pure TypeScript modules where possible. Do not bury core logic inside page components.

## Svelte requirements

Use modern Svelte 5 conventions:

- Use runes mode for new components.
- Use `$state` only for reactive state.
- Use `$derived` or `$derived.by` for computed values.
- Avoid using `$effect` to derive state.
- Keep side effects limited to persistence, timers, and browser integration.
- Use modern event attributes such as `onclick`.
- Use `$props` rather than legacy `export let`.
- Use keyed each blocks with stable IDs.
- Avoid deprecated Svelte syntax.
- Avoid shared SSR module state that could leak between requests.
- Use client-safe browser API access.
- Keep components focused and reasonably small.
- Run the Svelte autofixer on every created or modified `.svelte` file before finishing.

## Visual direction

Create an original, restrained visual system:

- Serious, focused, fast, and precise
- High contrast
- Strong typographic hierarchy
- Tabular or monospace numerals for timers and arithmetic
- Comfortable reading width
- Responsive from mobile through desktop
- Excellent keyboard focus states
- Light and dark themes
- Minimal motion
- Respect `prefers-reduced-motion`
- No decorative gradients
- No glassmorphism
- No oversized generic landing-page hero
- No nested card overload
- No fake testimonials, pricing, marketing copy, or stock imagery
- Avoid making it look like a children’s game
- Use color purposefully for status, while never relying on color alone

During timed sessions, remove unnecessary navigation and distractions. Make the prompt, answer controls, and timer the dominant visual elements.

## Accessibility

Meet practical WCAG AA expectations:

- Semantic landmarks and headings
- Proper labels and descriptions
- Full keyboard operation
- Visible focus
- Adequate contrast
- No color-only correctness indicators
- Reduced-motion handling
- Screen-reader-friendly form errors
- Sensible announcements for session state without announcing every timer tick
- Touch targets of usable size
- Arrow patterns with accessible text alternatives or equivalent labels

## Data reset

Settings must include “Delete all local data.”

Requirements:

- Explain exactly what will be deleted.
- Require explicit confirmation.
- Offer a JSON export immediately before deletion.
- Delete IndexedDB data only after confirmation.
- Reinitialize the application cleanly.
- Never conflate deleting browser data with exporting a backup.

## Testing

Write meaningful tests rather than superficial snapshots.

Unit-test:

- Mental-math generator invariants
- Exact division
- Difficulty ranges
- Pattern generator correctness
- Guaranteed mismatches
- Scoring
- Accuracy calculations
- Average and median response times
- Active-duration calculations
- Timer behavior
- Backup serialization
- Backup validation
- Merge deduplication
- Schema migration behavior

Browser-test at least:

1. First visit shows Import or Start Fresh.
2. Start Fresh reaches the dashboard.
3. Completing an answer creates local progress.
4. Reloading restores progress automatically.
5. Export creates a valid JSON download.
6. Import restores a backup.
7. Invalid import does not modify existing data.
8. Keyboard controls work in both exercises.
9. A stale backup state enables the native leave warning.
10. Reset requires confirmation and removes local data.

Use fake timers or injectable clocks where appropriate so timing tests are deterministic.

## Validation and completion

After implementing:

1. Run dependency installation with Bun.
2. Run formatting.
3. Run Svelte checks and TypeScript checks.
4. Run linting.
5. Run unit tests.
6. Run Playwright tests if the environment supports them.
7. Run the production build.
8. Inspect the rendered application at mobile and desktop widths if browser tooling is available.
9. Fix discovered problems rather than merely reporting them.
10. Run the Svelte autofixer on all Svelte components.

Expected commands should use Bun, such as:

- `bun install`
- `bun run check`
- `bun run lint`
- `bun run test`
- `bun run test:e2e`
- `bun run build`

Do not use npm, pnpm, or yarn.

Finish by reporting:

- What was built
- Important architecture decisions
- Browser limitations around close-time backup prompts
- Validation commands and results
- Any remaining limitations

Do not deploy, create external accounts, or add cloud services.
