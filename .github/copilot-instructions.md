# WoS+ (Words on Stream Plus) - AI Coding Agent Instructions

## Project Overview

**WoS+** is a real-time game enhancement tool for "Words on Stream" (WoS) on Twitch. It provides two interfaces:

- **Player View** ([player.astro](../src/pages/player.astro)): Track words, letters, and personal records
- **Streamer View** ([streamer.astro](../src/pages/streamer.astro)): OBS-ready layout with embedded game board and Twitch chat

Built with **Astro 7 + TypeScript**, deployed to **Cloudflare Pages** with Workers for serverless API routes.

The authoritative versions are always in `package.json`, which **exact-pins**
every dependency (`"astro": "7.0.9"`, not `"^7.0.9"`). Match that convention:
`pnpm add --save-exact`.

### Suitable Tasks for AI Agent

This project is well-suited for:
- Bug fixes in game state tracking or UI rendering
- UI/UX improvements and styling enhancements
- Documentation updates
- Adding new game event handlers
- Refactoring existing code for clarity
- Performance optimizations

Avoid tasks requiring:
- Changes to external API integrations (WoS, Twitch) without testing
- Modifications to core WebSocket message processing without understanding event flow
- Changes to dictionary algorithms without understanding letter matching logic

## Setup Instructions

### Prerequisites
- Node.js 22 (what CI runs — see `.github/workflows/tests.yml`)
- **pnpm** — the `packageManager` field in `package.json` is authoritative.
  Not npm; the lockfile is `pnpm-lock.yaml`.

### Getting Started
```bash
# Install dependencies
pnpm install --frozen-lockfile

# Start development server (runs on http://localhost:4321)
pnpm run dev

# Build for production (outputs to ./dist)
pnpm run build

# Preview production build locally (requires wrangler)
pnpm run preview
```

### Environment Setup
- No `.env` file needed for local development
- Production environment variables are configured in Cloudflare Pages dashboard
- Database scripts require `SUPABASE_URL` and `SUPABASE_KEY` environment variables

## Architecture

### Core Components

1. **Game State Manager** ([wos-plus-main.ts](../src/scripts/wos-plus-main.ts))

   - `GameSpectator` class orchestrates all game tracking
   - Connects to WoS WebSocket (Socket.IO v2) and Twitch chat (tmi.js)
   - Uses two Web Workers for message processing to prevent blocking UI
   - Maintains slot-based game state with `currentLevelSlots` tracking words at specific indices

2. **Web Workers** - **Critical**: Both workers use `postMessage` for async communication

   - [wos-worker.ts](../src/scripts/wos-worker.ts): Processes 12 WoS event types (1=LevelStart, 3=CorrectGuess, 4=LevelResults, 5=GameEnded, 10=LettersRevealed, 12=GameConnected)
   - [twitch-chat-worker.ts](../src/scripts/twitch-chat-worker.ts): Filters chat messages matching `/^[a-zA-Z]{4,12}$/`

3. **Dictionary System** ([wos-words.ts](../src/scripts/wos-words.ts))

   - Remote dictionary loaded from `https://clarkio.com/wos-dictionary`
   - `findWosWordsByLetters()`: Letter frequency matching algorithm
   - `findAllMissingWords()`: Identifies potentially missed words at level end
   - **Words are NOT auto-added to the dictionary, and there is no client-side
     path to add one at all.** `/api/words` exports `GET` and `OPTIONS` only.
     The former `updateWordsDb` PATCH path and the commented-out `POST`
     handler were both deleted — new words are derived from boards, in the
     database layer, as part of the board save flow. See
     [specs/README.md § Decisions from the #160 review](../specs/README.md)
     (W1, [#171](https://github.com/clarkio/wos-plus/issues/171)).

4. **API Routes** ([src/pages/api/](../src/pages/api/)) - All require `prerender = false`
   - Access Cloudflare env via `locals.runtime.env` (e.g., `env.SUPABASE_URL`)
   - Supabase clients come from `getSupabaseClient()` in `src/lib/supabase.ts`
   - JSON responses come from `jsonResponse()` in `src/lib/api-utils.ts`
   - CORS headers and preflight responses come from `src/lib/cors.ts`; pass the route's complete method set for write routes

### Key Data Flows

```
WoS Event Flow:
Socket.IO → wos-worker → GameSpectator.handleCorrectGuess() → updateCurrentLevelSlots[index] → UI

Masked Guess Resolution:
WoS sends "????" → Match username + timestamp → Twitch chat log → Reveal actual word

Missing Word Detection:
Level ends → logMissingWords() → findAllMissingWords(knownLetters, minLength) → Display with * suffix
```

> **WoS+ has no level threshold.** An earlier version of this file said "Level
> 20+" and comments in `wos-plus-main.ts` / `wos-words.ts` say "level 19+". Both
> describe *the game*, not this tool: `currentLevel` is only ever assigned and
> displayed, never compared against anything, and `updateGameState` picks the
> masked path purely on `word.includes('?')`. A masked event at level 3 is
> resolved exactly like one at level 19 — pinned by a test in
> `tests/acceptance/game-flow.acceptance.test.ts`.
>
> **Which level the game starts masking at is an open question for the
> maintainer** — the code says 19, this file used to say 20, and nobody has
> confirmed either. See `specs/game-flow.md § Masked guesses` and
> [specs/README.md § Open questions](../specs/README.md) (G1). Do not "fix" the
> discrepancy by adding a threshold to WoS+; there is nothing there to fix.

## Development Workflows

### Build and Development Commands
```bash
pnpm run dev         # Astro dev server on http://localhost:4321
pnpm run build       # Build for Cloudflare Pages (outputs to ./dist)
pnpm run preview     # Build + Wrangler local preview (tests Workers)

# Database scripts (require SUPABASE_URL and SUPABASE_KEY env vars)
pnpm run db:fix-board-ids
pnpm run db:insert-words-from-boards -- --apply
```

### Code Quality
- **ESLint 9** (`pnpm run lint`, type-aware, `--max-warnings 0`): pre-existing
  findings are suppressed in `eslint-suppressions.json`; new violations fail
- **TypeScript strict mode**: Enabled via `astro/tsconfigs/strict`
- **Type checking**: `pnpm run check` (`astro check`) type-checks `.astro` and
  `.ts` files. The Cloudflare build does *not* type-check, so run this too.
- **Build validation**: Always run `pnpm run build` after code changes to ensure TypeScript compilation succeeds
- **Full local gate** (see [CLAUDE.md](../CLAUDE.md)):
  `pnpm run check && pnpm run lint && pnpm run test:coverage && pnpm run build`

### Testing

**An automated test suite exists and is the primary way to verify changes.** See
[TESTING.md](../TESTING.md) for the full guide (conventions, patterns, examples).

**Two streams, both required.** `tests/unit/` and `tests/property/` describe
what the code does; `tests/acceptance/` encodes the human-approved behavioural
contract in [specs/](../specs/). An agent can always write unit tests that agree
with whatever it built — it cannot do that to the acceptance stream.

- **Stack**: [Vitest](https://vitest.dev/) 4 with `happy-dom` as the default
  test environment, `msw` at the HTTP boundary for the acceptance stream,
  `fast-check` for the property stream, and `@vitest/coverage-v8` for coverage.
  Config lives in [vitest.config.ts](../vitest.config.ts); `globals: true`, so
  `describe`/`it`/`expect`/`vi` need no import.
- **Layout**:
  - `tests/unit/` — unit tests for individual modules (`src/scripts/*`, `src/lib/*`)
  - `tests/acceptance/` — `*.acceptance.test.ts`, one file per behaviour area,
    each `describe` citing its `specs/` section. API routes are invoked directly
    through `invokeRoute` in `tests/acceptance/api-harness.ts`; Supabase is faked
    at the HTTP boundary by `tests/acceptance/network-mock.ts`, never with
    `vi.mock`. Most files need `// @vitest-environment node`.
  - `tests/property/` — `fast-check` invariants for the dictionary and
    normalizers
  - `tests/fixtures/` — recorded WoS event sequences
  - `tests/stubs/` — module stubs aliased in `vitest.config.ts` (notably
    `cloudflare:workers`)
  - `tests/setup.ts` — global setup, loaded via `setupFiles`; mocks `Worker`,
    `WebSocket`, and env vars for every test
  - `tests/test-utils.ts` — shared helpers (`mockFetchResponse`,
    `createMockLocalStorage`, `createMockWebSocket`, `createMockWorker`, `wait`)
  - `tests/smoke.test.ts` — basic sanity checks
  - There is **no** `tests/integration/`. It held `it.todo` placeholders for the
    API routes; all are now real acceptance tests and the file was deleted.
- **Path aliases** work in tests exactly as in source: `@/`, `@scripts/`,
  `@components/`, `@layouts/`, `@pages/`.
- **Commands**:
  ```bash
  pnpm test                 # watch mode — local development only, never CI
  pnpm run test:run         # single run — this is the CI/agent command
  pnpm run test:acceptance  # the acceptance stream alone (a subset of test:run)
  pnpm run test:property    # the property stream alone (a subset of test:run)
  pnpm run test:ui          # Vitest visual UI
  pnpm run test:coverage    # single run + v8 coverage report
  ```
- **Expectation for changes**: any behavior change should come with tests. Add
  or update tests alongside (preferably before) the implementation, and never
  delete or weaken an existing assertion to make a change pass. A change to
  observable behaviour also needs a **spec diff in `specs/` that a human
  approves first** — spec, then acceptance tests, then code.
- **Open questions**: scenarios marked ❓ Unconfirmed in `specs/`, and the
  `it.todo`s that name them, are questions for the maintainer, not chores.
  They are indexed in [specs/README.md § Open questions](../specs/README.md).
  Do not resolve one, and do not delete a deliberate `it.todo`.
- **Coverage** is reported for every file under `src/**/*.ts`, including files
  no test imports yet — so untested modules show up as `0%` rather than
  disappearing from the report. Current figures are in
  [CLAUDE.md](../CLAUDE.md) §4.

#### Manual verification (supplement, not substitute)

The automated suite cannot exercise the live WoS WebSocket or Twitch chat. After
the suite is green, verify end-to-end behavior by hand when touching those paths:

  1. Start dev server with `pnpm run dev`
  2. Open player view: `http://localhost:4321/player.astro?mirrorUrl=ROOM_ID&twitchChannel=CHANNEL`
  3. Open streamer view: `http://localhost:4321/streamer.astro?mirrorUrl=ROOM_ID&twitchChannel=CHANNEL`
  4. Connect to an active WoS game to observe behavior

- **Manual validation checklist**:
  - Check browser console for errors
  - Verify WebSocket connections establish successfully
  - Confirm UI updates when game events occur
  - Test with different query parameters

### Environment Variables

Required in **Cloudflare Pages dashboard** (not .env):

- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_KEY`: Supabase service key

## Project Conventions

### TypeScript Patterns

- Trust type inference for simple variables (`let level = 0`)
- Define interfaces in worker files (`WosWorkerMessage`, `TwitchWorkerResult`)
- Use inline types for slots: `{ letters: string[], user?: string, hitMax: boolean, index: number, length: number }`

### Astro-Specific

- All game logic runs **client-side** in `<script>` tags (no SSR for game state)
- **Query params drive configuration**: `?mirrorUrl=...&twitchChannel=...&clearSound=true`
- Settings dialogs use `SettingsDialog.astro` component with `__api` pattern for programmatic control
- Page initialization listens to both `DOMContentLoaded` and `astro:page-load` for ViewTransitions

### State Management

- **No framework state**: Pure DOM manipulation via `document.getElementById()`
- **localStorage keys**: Prefixed pattern `pb_${channel}`, `pb_${channel}_${date}`, `clears_${channel}_${date}`
- Missing required params triggers settings dialog automatically
- **Board IDs**: Normalize and validate with `validateBoardName` from `src/lib/board-utils.ts`; do not duplicate the 4–12 letter rule in callers
- **Twitch logins**: Normalize with `normalizeTwitchLogin` from `src/scripts/twitch-channel.ts`; the approved contract is 1–50 letters, digits, or underscores

### UI Rendering

```typescript
// Words grouped by length, sorted alphabetically, missed words marked with *
const groupedWords = sortedWords.reduce((map, word) => {
  const key = word.replace("*", "").length;
  map.get(key)!.push(word);
  return map;
}, new Map<number, string[]>());
```

## Adding Features

### New WoS Event Handler

1. Add case in [wos-worker.ts](../src/scripts/wos-worker.ts) `onmessage`
2. Create handler method in `GameSpectator` class
3. Route in `startEventProcessors()` switch statement

### New Settings Option

1. Add input to `SettingsDialog` form in page's `.astro` file
2. Handle in `setupDialogCallbacks()` → add to URL params
3. Read in `initializePage()` and apply to `spectator` instance

### New API Route

1. Create file in `src/pages/api/` with `.ts` extension
2. Add `export const prerender = false;` at top
3. Access env via `const { env } = locals.runtime;`
4. Use `getCorsHeaders` and `createCorsPreflightResponse` from `src/lib/cors.ts`
5. Use `getSupabaseClient` and `jsonResponse` instead of constructing clients or JSON responses inline

## External Dependencies

| Service     | Purpose                | Connection                            |
| ----------- | ---------------------- | ------------------------------------- |
| WoS API     | Game events            | `wss://wos2.gartic.es` (Socket.IO v2) |
| Dictionary  | Word validation        | `https://clarkio.com/wos-dictionary`  |
| Twitch Chat | Hidden word resolution | IRC via `@tmi.js/chat`                |
| Supabase    | Board/word storage     | REST API (on 5-star clears)           |

## Known Edge Cases

See [LIST.todo](../LIST.todo) for active bugs. Critical scenarios:

- Multiple `?` hidden letters revealed at different times
- Chat message timing mismatches for masked guess resolution
- Big word detection when fake letters still present
- Slot-based missed word detection **is implemented** —
  `findMissingWordsFromBoard` in `wos-words.ts`, used by `logMissingWords` when
  the level's board is in the archive. (This file previously said it was not,
  and pointed at a planning document that no longer exists.) It matches by slot
  *position*, which is an open question — see
  [specs/README.md § Open questions](../specs/README.md) (W3).

## Common Pitfalls and Important Warnings

### Critical: Web Workers Communication
- **NEVER** use synchronous patterns with Web Workers
- **ALWAYS** use `postMessage()` for communication between main thread and workers
- Workers run in separate contexts - they cannot access DOM or share variables directly
- Example: Don't try to return values from worker functions; use message passing instead

### WebSocket Event Processing
- **Order matters**: Some events depend on previous state (e.g., CorrectGuess requires LevelStart)
- **Event type numbers are magic**: Don't change event type constants without understanding WoS protocol
- **Hidden word resolution**: Requires correlating WoS events with Twitch chat timestamps - timing is critical

### Astro-Specific
- **No SSR for game state**: All game logic must run in `<script>` tags marked for client execution
- **Query params are required**: Pages won't work without `mirrorUrl` and `twitchChannel` parameters
- **ViewTransitions**: Always listen to both `DOMContentLoaded` AND `astro:page-load` events

### Cloudflare Pages
- **API routes need `prerender = false`**: All API routes in `src/pages/api/` must disable prerendering
- **Environment access pattern**: Use `locals.runtime.env` not `process.env` in API routes
- **Workers limitations**: Some Node.js APIs unavailable in Workers runtime

### State Management
- **No persistence across page reloads**: All game state is in-memory (except localStorage for records)
- **Slots array is critical**: The `currentLevelSlots` array tracks word positions - corruption breaks everything
- **Dictionary must load**: If dictionary fails to load, word suggestions won't work

### Performance
- **Dictionary operations are synchronous**: Large dictionary operations can block UI
- **DOM manipulation is frequent**: Use efficient selectors; cache element references when possible
- **WebSocket message volume**: WoS can send many messages rapidly during active gameplay

## File Organization Patterns

### Page Files (`src/pages/*.astro`)
- Contain both HTML layout and client-side `<script>` logic
- Query parameter handling in `initializePage()`
- Settings dialog setup in `setupDialogCallbacks()`
- GameSpectator instance created and configured per page

### Script Files (`src/scripts/*.ts`)
- Pure TypeScript with no Astro dependencies
- Can be imported in both pages and workers
- Worker files have `self` context, not `window`

### Component Files (`src/components/*.astro`)
- Reusable UI components
- Minimal client-side logic (prefer page-level state management)
- Use props for configuration, not global state

### API Route Files (`src/pages/api/*.ts`)
- Must export `prerender = false`
- Use `APIRoute` type from Astro
- Access Cloudflare env via `context.locals.runtime.env`
