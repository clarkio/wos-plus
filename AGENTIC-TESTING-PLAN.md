# Agentic AI Testing Standards — Research & Implementation Plan for WoS+

This document captures current (2025–2026) industry research on how to build
confidence in code produced by agentic AI coding tools (Claude Code, Copilot
agents, etc.), and lays out a phased, concrete plan to apply those standards to
this project. Everything here is tailored to the WoS+ stack: **TypeScript +
Astro + Vitest + Cloudflare Pages/Workers + Supabase + pnpm**.

---

## Where this stands (keep current)

**Read this first if you are picking the work up cold.** The phase descriptions
in Part 3 are the original plan and were never rewritten as work landed, so they
describe intent, not status. This section is the status.

| Phase | Issue | State | Landed in |
| --- | --- | --- | --- |
| 0 — Fix the foundation | [#146](https://github.com/clarkio/wos-plus/issues/146) | ✅ done | PR #145 |
| 1 — Static analysis gate (ESLint 9 flat, type-aware) | [#147](https://github.com/clarkio/wos-plus/issues/147) | ✅ done | PR #159 |
| 2a — Close the unit-test gap in `wos-words.ts` | [#148](https://github.com/clarkio/wos-plus/issues/148) | ✅ done | PR #159 |
| 2b — Fixture-driven tests for `wos-worker` | [#149](https://github.com/clarkio/wos-plus/issues/149) | ✅ done | PR #159 |
| 2c — Coverage thresholds + ratchet | [#155](https://github.com/clarkio/wos-plus/issues/155) | ✅ done | PR #175 |
| 3 — Acceptance-test stream (ATDD) | [#151](https://github.com/clarkio/wos-plus/issues/151) | ✅ done | PR #160 |
| 4 — Property-based tests (fast-check) | [#150](https://github.com/clarkio/wos-plus/issues/150) | ✅ done | PR #159 |
| 5 — Mutation testing + change-risk | [#154](https://github.com/clarkio/wos-plus/issues/154) | ✅ done | this PR |
| 6 — Thin Playwright E2E | [#152](https://github.com/clarkio/wos-plus/issues/152) | ✅ done | this PR |
| 7 — Security & supply-chain gates | [#153](https://github.com/clarkio/wos-plus/issues/153) | ✅ done | this PR |
| 8 — Branch protection & agent contract | [#156](https://github.com/clarkio/wos-plus/issues/156) | ✅ done | PR #159 + maintainer enabled protection on `main` |

Epic tracker: [#157](https://github.com/clarkio/wos-plus/issues/157).

### The numbers, as of the #167 fix

**692 passing** tests across 19 files, plus 3 deliberate `it.todo`. Coverage
**91.41% statements / 87.77% branches / 88.94% functions / 92.08% lines**, counting
every file under `src/**/*.ts` so an untested module shows as 0% rather than being
invisible. `src/scripts/wos-widget.ts` is the one module no test imports.

`CLAUDE.md` § 4 is the authoritative copy of this and is kept current; if the two
ever disagree, believe `CLAUDE.md`.

### What to do next, and why

**#155 is done.** `vitest.config.ts` now enforces a global floor (statements 90,
branches 85, functions 87, lines 90) plus per-file floors for `wos-words.ts` and
`src/lib/**`, with a ratchet-only policy documented in `CLAUDE.md` § 4 and
`TESTING.md` § Coverage. `pnpm run test:coverage` fails below those numbers —
verified by temporarily raising a threshold above measured reality and watching
the run fail, then reverting.

The **behaviour issues** below (all thirteen from the #160 review) are now done,
and so are #153, #154, and #152. **Every phase in the table above is now done**
— #157 (the epic) is the only thing left open, and only as a tracking issue.

**#152 is done**, with explicit maintainer sign-off obtained before adding the
new dependency, per `CLAUDE.md` §5 (architecture-tier — same policy #154's
StrykerJS addition went through). `@playwright/test` 1.62.1 (exact-pinned) was
added, scoped to a thin smoke layer per the issue's own scope:

- `wrangler dev` **does run in this sandbox** — the open question the plan
  flagged going in. `curl http://127.0.0.1:8788/` and `/api/health` both
  answer 200 against a real `astro build` + `wrangler dev`. Two environment
  quirks needed working around, not signs the approach doesn't work: `wrangler
  dev` only binds IPv4, so Chromium resolving `localhost` to `::1` first hangs
  — `playwright.config.ts` uses `127.0.0.1` explicitly; and Chromium refuses
  to start its own sandbox as root (this sandbox's user), worked around with
  `--no-sandbox` in `launchOptions.args`, gated on `PLAYWRIGHT_CHROMIUM_PATH`
  being set so a normal non-root CI runner is unaffected.
- **Scope**: `tests/e2e/smoke.spec.ts` covers `/`, `/player`, `/streamer`
  loading without unexpected console errors; `/api/health` returning 200
  through the real Workers runtime; and the settings dialog opening when
  required query params are missing (both `/player` and `/streamer`).
  `tests/e2e/settings-dialog.spec.ts` covers the settings dialog's URL-param
  round trip. Twitch chat connections stay out of scope, per the issue —
  `tests/e2e/e2e-harness.ts`'s `blockExternalNetwork` aborts Google Fonts and
  Twitch's GQL lookup over HTTP, and mocks the WoS mirror WebSocket
  (`wos2.gartic.es`, opened by Save via socket.io's `transports: ['websocket']`
  — `page.route` can't intercept that, only `page.routeWebSocket` can) so the
  suite stays hermetic (same "zero real network" convention the acceptance
  stream already uses) even though the URL-round-trip test doesn't itself
  assert on console output.
- **A real, known gap, not swept under the rug**: `e2e.yml` provisions no
  Supabase secrets, so `/player` and `/streamer`'s in-page word-dictionary and
  channel-stats fetches fail there the same way they would locally without
  `.dev.vars` — already caught and logged by the routes rather than thrown, so
  the page still renders. `e2e-harness.ts`'s `collectUnexpectedFailures` names
  this gap explicitly via a dedicated, URL-attributed check
  (`unexpectedRequestFailures`, built from `requestfailed`/`response` events
  against the known-expected list: `/api/words`, `/api/channel-stats/*`, plus
  the blocked hosts above) rather than trying to pattern-match generic
  console text, which carries no URL. An earlier version tracked expected
  failures as a single page-global counter decremented against generic
  console messages; review on PR #194 caught that console and network events
  aren't guaranteed to arrive in a correlated order, so an unrelated failure
  could silently consume budget left over from an earlier expected one. The
  fix judges the two independently instead: generic resource-failure console
  text is dropped outright (unattributable), and the URL-based network check
  is what actually catches an unrelated failure, regardless of what else
  failed first — covered by a regression test in `tests/e2e/smoke.spec.ts`.
  Wiring real or sandboxed credentials into the
  job is future work, out of scope for a suite whose actual target is
  `prerender = false` / `locals.runtime.env` misconfiguration and
  page-load/dialog behaviour.
- `docs/BRANCH-PROTECTION.md`'s `e2e` row is now marked available (job `e2e`
  in `.github/workflows/e2e.yml`), with the Supabase-secrets gap noted there
  too; it is not yet ticked as a required check — that's a maintainer action,
  same as the other rows in that table.

### The behaviour backlog from the #160 review

Thirteen issues, all approved by the maintainer:
[#161](https://github.com/clarkio/wos-plus/issues/161)–[#173](https://github.com/clarkio/wos-plus/issues/173).
**[#173](https://github.com/clarkio/wos-plus/issues/173),
[#170](https://github.com/clarkio/wos-plus/issues/170),
[#166](https://github.com/clarkio/wos-plus/issues/166),
[#164](https://github.com/clarkio/wos-plus/issues/164),
[#168](https://github.com/clarkio/wos-plus/issues/168),
[#161](https://github.com/clarkio/wos-plus/issues/161),
[#163](https://github.com/clarkio/wos-plus/issues/163),
[#171](https://github.com/clarkio/wos-plus/issues/171),
[#162](https://github.com/clarkio/wos-plus/issues/162) and
[#169](https://github.com/clarkio/wos-plus/issues/169) are done** (PR
[#176](https://github.com/clarkio/wos-plus/pull/176), the #170 fix, the
#166 fix, the #164 fix, the #168 fix, the #161 fix, the #163 fix, the
#171 fix, the #162 fix and the #169 fix). **[#165](https://github.com/clarkio/wos-plus/issues/165)
and [#167](https://github.com/clarkio/wos-plus/issues/167) are also done** —
the two that overlapped stale open draft PRs (#142 and #144 respectively; see
below). All thirteen issues from the #160 review are now closed.

**#169 is done** — the WOS socket's `reconnect` event (fired by socket.io only
after a previously-connected socket recovers, never on the initial connect)
now marks the next "Game Connected" event as a genuine reconnect rather than a
first-time join to a level already in progress — the two cases the game
reports identically on the wire. Only a confirmed reconnect rebuilds
`currentLevelCorrectWords` from the re-reported slots
(`rebuildFoundWordsAfterReconnect` in `wos-plus-main.ts`), and only when none
of the filled slots is masked (`letters` containing `'?'`) — a masked guess's
word can't be recovered after the outage, so that level's found-words list
keeps its gap rather than being partially filled. The reconnect flag is
consumed by the first "Game Connected" event after it is set, so a later
join-in-progress on the same connection doesn't re-trigger a rebuild. Covered
by new unit tests in `tests/unit/wos-plus-main.test.ts` (no acceptance test:
this is client/game-flow behavior, not an API route). `specs/game-flow.md` §
reconnecting to a level that has masked guesses is now ✅ Confirmed rather
than ⚠️.

**#162 is done** — `POST /api/boards` now applies the same board-name and
slot-shape rules that lookup (`GET /api/boards/[id]`) and repair (`PUT
/api/boards/[id]`) already enforced. Two helpers moved to
`src/lib/board-utils.ts` so all three routes share one implementation instead
of three: `validateBoardName` (the 4–12-letters-only rule, previously private
to `[id].ts`) and `isWellFormedSlot` (the `letters` array + non-empty `word`
shape check, previously inlined in the `PUT` handler). A save whose id isn't
present is still let through to the guard that actually explains it (redundant
words, then language) rather than being blocked by a name check that was never
the point of those scenarios — matching the existing acceptance tests that
capture a nameless board on purpose. The slot-shape guard also closes the
completeness gap noted under "Capturing a board": a slot with an empty word is
exactly what it rejects, so the `it.todo` there became a real test. The two
`known gap (#162)` describes in `boards.acceptance.test.ts` were moved into a
new `specs/boards.md — Saving a board directly` describe and inverted, not
deleted; `specs/boards.md` § Saving a board directly is now ✅ Confirmed for
both scenarios.

**#171 is done** — the retired client-side word-adding path is gone, not just
unreachable: `updateWordsDb` in `src/scripts/wos-words.ts` (PATCHed the
external `clarkio.com/wos-dictionary` URL, had no callers) and the
commented-out `POST` handler in `src/pages/api/words.ts` are both deleted.
`/api/words` now exports `GET` and `OPTIONS` only, which is unchanged — the
route never had a working write path to begin with. The `known gap (#171)`
`it.todo` in `words.acceptance.test.ts` was replaced with a real assertion
(the add path no longer exists in the module at all), not deleted, and
`specs/words.md` § Where new words come from is now ✅ Confirmed rather than
⚠️. Only *adding* was retired; `GET /api/words` and `loadWordsFromDb` are
untouched and still back the missed-word fallback and masked-guess recovery.

**#161 is done** — both `POST /api/boards` and the client's `saveBoard` in
`src/scripts/db-service.ts` now reject a fresh save whose word language is
missing or unrecognised, instead of silently substituting English. The
self-healing repair branch (an existing board saved with redundant words,
replaced via `PUT /api/boards/[id]`) deliberately keeps its old fallback —
`specs/boards.md` § Repairing a board already says a repair carrying no
language leaves the stored value alone, and that scenario was out of #161's
scope. The two `known gap (#161)` acceptance scenarios in
`boards.acceptance.test.ts` were inverted, not deleted, and a new scenario
for "no language key at all" was added alongside them.
`specs/boards.md` § Channel and language on a captured board is now ✅
Confirmed for both scenarios rather than ⚠️.

Separately, **[#172](https://github.com/clarkio/wos-plus/issues/172)** (the X1
gap: export the `OPTIONS` handlers the three Supabase-backed routes already
advertise) is also done — `/api/boards`, `/api/boards/[id]` and
`/api/channel-stats/[channel]` now each export an `OPTIONS` handler answering a
204 with the route's existing static CORS headers, and the `advertises OPTIONS
but exports no handler for it` canaries in `boards.acceptance.test.ts` (×2) and
`channel-stats.acceptance.test.ts` were inverted, not deleted. #172 was not one
of the thirteen #160-review issues — it tracked a transport-layer gap (X1 in
`specs/README.md`), not a game-behaviour spec scenario, so no `specs/*.md`
change was needed.

Each open one has a ⚠️ scenario in `specs/` and an acceptance test **pinning
current behaviour** under the name `known gap (#N)`. That is the mechanism to
understand before touching any of them: the test asserts behaviour the
maintainer has already ruled *wrong*, on purpose, so implementing the fix
cannot happen quietly. **Invert the assertion in the same PR — never delete it
to get green.** A red `known gap` test is the system working. #173 shows the
pattern: the route now tells the all-time and daily lookups apart from a
genuine "no rows yet" (`PGRST116`) and answers a failure rather than
fabricating a 200 with zeros, and the `known gap (#173)` canary in
`channel-stats.acceptance.test.ts` was inverted, not deleted.

#170 shows a variant of the pattern worth knowing before touching a similar
issue: the defect turned out to be entirely in the **view** layer
(`GameSpectator.refreshChannelStats()` in `src/scripts/wos-plus-main.ts`),
not the route. The route's per-request `chatbotEnabled: false` fail-closed
answer on a genuine read error was already correct and stays unchanged — only
the client's handling of that answer needed to become sticky (`chatbotEnabled`
now only ever turns on, mirroring how the three numbers only ever rise). The
route-level `known gap (#170)` acceptance test was reframed as confirmed
rather than inverted in place, because the value it pins never changes; the
real fix is proven by a new test in `tests/unit/wos-plus-main.test.ts` §
`refreshChannelStats`. See `specs/channel-stats.md` § "a temporary failure
does not hide the daily badges" for the full reasoning.

#166 (all-time best follows the game's reported record on connect) narrowed in
scope during implementation, worth knowing before assuming an issue's text is
the final word: the original text called for WoS+ to write the game's record
back to `wos_channel_all_time_records`, but that would have been a new,
unauthenticated write path — an architecture-tier change under `CLAUDE.md` §5
that needs sign-off regardless of confidence, and it opened a spoofing
question (any client could claim a fabricated record). Asked directly, the
maintainer confirmed no write-back is needed at all: the chatbot already keeps
the table in sync for channels that have it, and nothing has ever written it
for channels that don't, so the fix is purely a display update in
`GameSpectator`'s Game Connected handler. Proven by a new test in
`tests/unit/wos-plus-main.test.ts` § "worker routing (startEventProcessors)".

**#168 is done** — `validateBoardId` in `src/pages/api/boards/[id].ts` and both
length checks in `src/scripts/db-service.ts` (save and fetch) now enforce
4–12 letters, matching the chat filter. The migration risk flagged in the
issue was already cleared in the #160 review (no stored board id exceeds 12
letters), so no data migration was needed. The `known gap (#168)` acceptance
test in `boards.acceptance.test.ts` was inverted in place, plus a new
boundary test for the longest-valid (12-letter) name; the length assertions
in `tests/unit/db-service.test.ts` were updated to the new numbers.
`specs/boards.md` § Naming a board is now ✅ Confirmed rather than ⚠️.

**#163 is done** — `PUT /api/boards/[id]` now treats a stored board as broken
(and eligible for repair) when a slot's word cannot be spelled from the board
id's letters (the board's big word), not just when a word is repeated.
`findInvalidWords`/`hasInvalidWords` in `src/lib/board-utils.ts` reuse
`canFormWord`'s letter-frequency check from `wos-words.ts`, per the issue's own
note, rather than a third re-implementation. The "sound stored board" guard
widened to match — a board is sound only if it has *neither* repeated words
*nor* invalid words — and its refusal message changed from naming redundant
words specifically to the general "is already sound", since the guard now
covers two independent reasons a board can be broken.
`specs/boards.md` § Repairing a board that was stored badly is now ✅
Confirmed rather than ⚠️ for that scenario.

**#164 is done** — the leading-`#` strip on the channel-stats read path
(`src/pages/api/channel-stats/[channel].ts`) already matched the board path's
behaviour, but reimplemented the transform inline instead of sharing it with
`normalizeTwitchChannel` (`src/lib/board-utils.ts`). The shared step —
trim, strip a leading `#`, lowercase — is now `cleanTwitchChannel`, exported
from `board-utils.ts` and used by both `normalizeTwitchChannel` (board path)
and the channel-stats route, instead of being duplicated. The route keeps its
own format/length checks after cleaning (not a call to `normalizeTwitchChannel`
itself), because the two paths give a caller different error messages for "bad
characters" vs. "too long" and `normalizeTwitchChannel` collapses both into a
single null — folding that distinction away for a strings-only refactor would
have been an unrelated behaviour change. No acceptance test changed; the
`#164` scenario in `channel-stats.acceptance.test.ts` (§ "a channel name
written the way a streamer would type it") already pinned the correct
behaviour and stays green, unchanged.

**#165 is done** — the reconciliation this section used to point at as the next
step. Draft PR #142 ("fix: key boards by the alphabetically last big word") was
checked against #165's precise approved rule — longest, then alphabetically
last among ties — and found to already implement it correctly: `hitMax` (the
WoS event flag that sets `currentLevelBigWord`) is only ever true for a guess
that uses every letter in the level, so every candidate `determineBoardId`
compares is already the same, maximal length by construction. The "longest"
half of the rule is therefore structural, not something the implementation
needed to compute separately — the only real work was the alphabetical
tie-break, which PR #142 already had right. Rather than reconcile the stale
draft branch (opened against a much older `main`) via rebase, the fix was
re-applied directly onto current `main`: `determineBoardId(bigWord,
extraCandidates)` in `src/scripts/wos-words.ts` picks the alphabetically last
anagram among the tracked big word, the level's filled slot words, and the
loaded dictionary; `GameSpectator` (`src/scripts/wos-plus-main.ts`) uses it on
both save (`handleLevelResults`) and lookup (`logMissingWords`, which retries
under the guessed big word for boards saved before ids were canonicalized);
`db-scripts/fix-board-ids.mjs` was updated to target the same canonical id for
a one-off data migration. Covered by new unit tests in
`tests/unit/wos-words.test.ts` and `tests/unit/wos-plus-main.test.ts`, and a
new end-to-end acceptance scenario in `tests/acceptance/game-flow.acceptance.test.ts`
§ "Ending a level" that guesses two anagrams (RULING, then LURING landing in
the level's last slot) and asserts the board is captured under `RULING`, not
the positionally-last guess. The `known gap (#165)` placeholder in
`tests/acceptance/boards.acceptance.test.ts` was inverted (not deleted) to pin
the fixed rule directly against `determineBoardId`, since the id resolution
itself happens before `/api/boards` is ever called and isn't otherwise
reachable from the route. `specs/boards.md` § "which word a board is filed
under" is now ✅ Confirmed rather than ⚠️. Draft PR #142 was closed as
superseded (with an explanatory comment) rather than reconciled — the fix
landed as new work on top of current `main` instead of through that stale
branch.

**#167 is done** — all thirteen issues from the #160 review are now closed.
`updateGameState` in `src/scripts/wos-plus-main.ts` no longer drops an
unrecoverable masked guess: it still records the slot via
`updateCurrentLevelSlots`, but with masked (`'?'`-filled) `letters`/`word`
rather than a resolved word. That single change gets both approved outcomes
for free, because of how they were already wired: `slot.user` being truthy
is what `currentLevelSlots.every(slot => slot.user)` (clear detection) and
`findMissingWordsFromBoard`'s `!currentSlot.user` check (missed-word
exclusion) both key off, and `saveBoard`'s existing
`slot.letters.includes('?')` guard (`db-service.ts`) already refuses to
persist a masked slot — so the board-capture block needed no new code at
all, only for the slot to stop being silently dropped. Two other acceptance
scenarios that incidentally asserted `slot.user` stayed `undefined` after an
unresolved masked guess (`does not choose a word that is already on the
board`, and the renamed `records the slot masked and says so when no chat
message can be the word (#167)`) were updated in the same PR, since they
encoded the same pre-#167 behaviour without being marked as the `known gap`.
Covered by a new unit test in `tests/unit/wos-plus-main.test.ts` §
`updateGameState` and the inverted acceptance test in
`tests/acceptance/game-flow.acceptance.test.ts` § Masked guesses.
`specs/game-flow.md` § "no matching chat message" is now ✅ Confirmed rather
than the removed ⚠️ "a masked guess that cannot be recovered" scenario.

Draft PR #144 ("Record unrecoverable hidden mobile guesses as solved, not
missed") was the open PR #167 pointed at for reconciliation. Its description
already outlined the same `saveBoard`-guard approach, but the branch was
opened against a much older `main` (July 18) and never rebased — the same
staleness #165 hit with PR #142. Rather than reconcile it, the fix landed as
new work directly on current `main`, and #144 was closed as superseded with
an explanatory comment, mirroring how #142 was handled. #144's broader mobile
scope (issue #143 — masked guesses from `play.wos.gg`, and reconciling a
masked slot once WoS reveals it) was **not** re-implemented; only the #167
slice (decoupling clear detection from board capture) was in scope here. If
#143's wider mobile-guess handling is still wanted, it needs a fresh issue or
PR against current `main`, not a revival of #144.

With all thirteen #160-review issues closed, the next open items are #153
(security & supply-chain gates — cheap, workflow files only) and #154
(mutation testing, needs maintainer sign-off for the StrykerJS dependency per
`CLAUDE.md` §2.3). #152 (Playwright E2E) stays last or never, per the
existing sandbox caveat below.

**#153 is done.** Four workflow files, no source/test/build-config changes,
per its scoped acceptance criteria:

- `.github/workflows/codeql.yml` — CodeQL, `javascript-typescript`, job named
  `analyze` (matches `docs/BRANCH-PROTECTION.md`'s required-checks table), on
  PRs, pushes to `main`, and a weekly schedule.
- `.github/workflows/dependency-review.yml` — `actions/dependency-review-action`
  on PRs, job named `dependency-review`, failing on high-severity advisories.
  This is the mechanical defense against a hallucinated or malicious package
  entering via an agent PR.
- `.github/workflows/security.yml` — two non-required jobs, defense in depth
  rather than primary gates: `gitleaks` (blocking; scans full git history on
  every PR/push) and `pnpm-audit` (`pnpm audit --prod`, currently
  `continue-on-error: true`).
- `.gitleaks.toml` — an allowlist, not a weakened rule. A first local run
  (`gitleaks git --config .gitleaks.toml -v .`) found one flagged string:
  `TWITCH_PUBLIC_CLIENT_ID` in `src/scripts/twitch-channel.ts`
  (`kimne78kx3ncx6brgo4mv6wki5h1ko`), which is Twitch's own published public
  web `Client-Id` for unauthenticated `gql.twitch.tv` lookups — reused openly
  by third-party Twitch tools, not a secret. That string plus the acceptance
  harness's known-fake Supabase credentials are allowlisted by exact value and
  path; nothing else is excluded, so a real credential anywhere else — even in
  those same files — still trips the scan. After the allowlist, the scan is
  clean (`no leaks found`, 97 commits).
- `pnpm audit --prod`, run locally for this PR: **7 high, 7 moderate, 0
  critical**, all transitive (astro/cloudflare/sentry toolchains,
  socket.io-client), none with a patched version available yet within this
  repo's pinned major versions. Left non-blocking per the issue, with the
  reasoning recorded in the workflow file and in
  `docs/BRANCH-PROTECTION.md`.
- `docs/BRANCH-PROTECTION.md` updated: the required-checks table now marks
  `analyze` and `dependency-review` available (job names matched what the
  table already reserved for them); a new paragraph explains why `gitleaks`
  and `pnpm-audit` are deliberately *not* required checks; the GitHub-native
  secret scanning / push protection section is now explicitly marked as
  needing maintainer/repo-admin action, which was implicit before.

No CodeQL or dependency-review run can be verified locally — both only run on
GitHub — so their YAML was validated with a parser (`python3 -c
"import yaml; yaml.safe_load(...)"`) rather than eyeballed, per the issue's
own instruction.

**#154 is done**, with explicit maintainer sign-off obtained before adding the
new dependency (`CLAUDE.md` §5 — architecture-tier, needs sign-off regardless
of confidence). `@stryker-mutator/core` and `@stryker-mutator/vitest-runner`
9.6.1 (exact-pinned) were added, scoped tightly per the issue's own scope list:
`src/lib/**`, `wos-words.ts`, `mirror-url.ts`, `twitch-channel.ts`, explicitly
excluding `wos-plus-main.ts`.

- **Measured baseline** (not guessed): a full `pnpm run test:mutation` run
  took 2 minutes 37 seconds and scored **79.31%** overall — board-utils.ts
  94.85, cors.ts 93.18, launch-menu.ts 43.28, mirror-url.ts 94.23,
  twitch-channel.ts 61.11, wos-words.ts 72.19. `stryker.config.json`
  `thresholds.break` is set to **79**, just below that measured number, per
  the issue's explicit instruction not to invent a number. The documented
  target of ≥70 is already cleared by every file except launch-menu.ts and
  twitch-channel.ts, so `break` tracks the real (higher) floor rather than the
  aspirational minimum; `low`/`high` are 79/90.
- **CI wiring** (`.github/workflows/mutation.yml`), deliberately its own
  workflow rather than a step in `tests.yml` so the slow mutation run never
  blocks the fast per-PR gate: an **incremental** job
  (`stryker run --incremental`) on every pull request, using
  `actions/cache` keyed on `github.run_id` with a `stryker-incremental-`
  prefix so each run restores the most recent prior incremental result and
  saves a fresh one; and a **full** job on a Monday 06:00 UTC schedule (plus
  manual dispatch) that uploads the HTML report as a 90-day workflow artifact.
  Neither job is a required status check yet — mutation testing here is a
  signal to act on, not a merge gate.
- **Change-risk (CRAP-style) analysis**: `eslint.config.js` adds the core
  `complexity` rule at `['error', 32]`. The ceiling was measured, not
  guessed either — the codebase's actual worst offender is `saveBoard` in
  `src/scripts/db-service.ts` at cyclomatic complexity 31
  (`GameSpectator.updateGameState` in `wos-plus-main.ts` is next at 29) — so
  32 is baselined just above the real number and the rule passes clean on
  existing code (`pnpm run lint` verified green). `.stryker-tmp/**` and
  `reports/**` were added to the ESLint `ignores` list alongside the existing
  `.claude/**` entry, for the same reason: both are full generated copies of
  the repo that would otherwise double-count every finding.
  **[#193](https://github.com/clarkio/wos-plus/issues/193)** tracks ratcheting
  that ceiling down as `saveBoard` and `updateGameState` get decomposed — the
  coverage ratchet has a stated quarterly target and the mutation-score
  ratchet has a stated ≥70 target; the complexity ratchet had only prose
  intent in `CLAUDE.md` § 8 until this issue gave it the same kind of tracked
  goal.
- `reports/` and `.stryker-tmp/` (the HTML report and the incremental-run
  cache) are gitignored — generated artifacts, not source; CI publishes the
  report as an artifact instead of committing it.
- Policy documented in `CLAUDE.md` § 8: a surviving mutant on lines a PR
  touches means that PR's tests don't actually constrain the new code — add
  an assertion, never suppress the mutant.

**With #152 done, every phase in the table above is closed.** #157 (the epic)
is the only tracking issue still open. `wrangler dev` turned out to run fine
in the sandbox this landed in — see § What to do next, and why for how that
was verified and what #152's implementation covers.

### Where the rest of the state lives

Nothing below duplicates these, deliberately — a second copy is a second thing to
go stale:

| What | Where |
| --- | --- |
| Current test counts, coverage, lint baseline | `CLAUDE.md` § 4 |
| The behavioural contract, and every decision behind it | `specs/README.md` § Decisions from the #160 review |
| Open spec questions | `specs/README.md` § Open questions — **empty right now**; the section is the mechanism, not a leftover |
| Testing conventions, the two streams | `TESTING.md` |
| Branch protection settings and required checks | `docs/BRANCH-PROTECTION.md` |
| Confirmed WoS wire payloads | `tests/fixtures/wos-events/README.md` |

---

## Part 1 — Research summary: what actually creates confidence in AI-generated code

### 1.1 The core problem

AI-generated code has a distinct defect profile. It compiles, looks idiomatic,
and passes shallow tests, but defects cluster in predictable categories:

- **Happy-path bias** — missing edge cases (empty inputs, nulls, unicode,
  concurrent access, large datasets).
- **Weak error handling** — catch-all blocks that swallow errors, network calls
  without timeouts, missing null checks.
- **Self-confirming tests** — when the same agent writes both the code and its
  tests in one pass, the tests verify what the code *does*, not what it
  *should do*. Both share the same blind spots.
- **Hallucinated dependencies** — roughly 20% of AI code samples reference
  packages that don't exist, which attackers exploit via "slopsquatting"
  (registering the hallucinated names on npm).
- **Plausible-but-wrong logic** — subtle off-by-one, inverted conditions, and
  boundary mistakes that line/branch coverage does not catch.

### 1.2 The consensus practices (and why each one works)

| # | Practice | Why it works against AI-specific failure modes |
|---|----------|------------------------------------------------|
| 1 | **Tests as independent specification (TDD for agents)** | Writing tests (or at least test descriptions) *before* the agent implements breaks the self-confirmation loop. Anthropic's own guidance: write failing tests → commit them → implement until green. Each red→green cycle gives the agent unambiguous, quantitative feedback it can iterate on autonomously, and the committed tests are a tamper-evident safety net — if the agent edits a test to make it pass, the diff shows it. |
| 2 | **Static analysis as the first gate** | Strict TypeScript + type-aware ESLint catches whole classes of AI mistakes (implicit `any` escape hatches, unhandled promises, unsafe narrowing) before a single test runs. Cheapest gate; runs in seconds; agents can self-correct against it. |
| 3 | **The Testing Trophy shape** (static → unit → *fat integration layer* → thin E2E) | "The more your tests resemble the way your software is used, the more confidence they can give you" (Kent C. Dodds / Testing Library principle). Integration tests catch the wiring mistakes AI makes between modules that unit tests with heavy mocks structurally cannot see. |
| 4 | **Mutation testing** | Coverage proves code was *executed*; mutation testing proves the tests would *fail if the code were wrong*. Stryker mutates the source (`>` → `>=`, `+` → `-`, boolean flips); surviving mutants are precise, actionable evidence of assertion gaps — exactly the gaps AI-written tests tend to leave. This is the single strongest verifier of *test quality* rather than test quantity. |
| 5 | **Property-based testing** | Instead of asserting on hand-picked examples (which an agent can overfit to), you assert *invariants* over hundreds of generated inputs (fast-check). This is the highest-leverage technique for algorithmic code — for WoS+, the letter-frequency word-matching engine. |
| 6 | **Higher, enforced coverage bars** | Industry guidance for AI-heavy codebases: 85–90% thresholds vs. the traditional 70–80% — *enforced in CI*, not aspirational in docs. Critically, coverage must include files with **zero** tests, or untested modules are invisible. |
| 7 | **Supply-chain verification** | Exact-pinned versions, frozen lockfile installs, dependency review on PRs, and audit scanning defeat hallucinated/slopsquatted packages. Any new dependency in an AI-authored PR gets human review by policy. |
| 8 | **Security scanning (SAST + secrets)** | AI code has a measurably elevated vulnerability rate (CWE-scannable issues, injection, missing authz). CodeQL/Semgrep + secret scanning on every PR catches these mechanically. |
| 9 | **Machine-checkable quality gates, verified in CI** | Agents follow tight feedback loops: the more quantitative the checks, the better they self-verify. Every gate must be runnable locally by the agent *and* enforced by CI as the final arbiter (`--max-warnings 0`, coverage thresholds, mutation score thresholds, required status checks). A gate an agent can't run is a gate it can't satisfy. |
| 10 | **Accurate agent instructions + PR discipline** | Agent instruction files (`copilot-instructions.md`, `CLAUDE.md`) are part of the quality system. Stale or wrong instructions produce wrong agent behavior. PRs from agents stay small, single-purpose, and carry a verification checklist. |
| 11 | **Production feedback loop** | Monitoring (already present here via Sentry) closes the loop: release health per deploy tells you whether the gates are actually working. |

### 1.3 Uncle Bob's "Agentic Discipline" — ATDD as the control system

Robert C. Martin ("Uncle Bob"), long the loudest advocate for clean,
reviewable, human-written code, now teaches a specific workflow for keeping
control of AI agents (his *Agentic Discipline* series on cleancoders.com and
posts from his Empire project). It sharpens the consensus above into a
concrete control system, and this plan adopts it. His workflow:

1. **Two independent test streams, both green at once.**
   - **Acceptance tests** — written in *domain language* (Given/When/Then),
     describing what the system does from the outside. These are the
     behavioral contract, co-authored with and approved by the human
     **before implementation exists**.
   - **Unit tests** — verifying internal structure, written test-first as
     development proceeds.

   His key observation: *"The two different streams of tests cause Claude to
   think much more deeply about the structure of the code. It can't just
   willy-nilly plop code around and write a unit test for it."* A single
   stream — especially agent-written unit tests — is self-confirming; the
   dual constraint is what forces real structure.
2. **Mutation testing as the third layer** — acceptance tests verify *what*,
   unit tests verify *how*, mutation testing verifies the tests themselves
   *actually catch bugs*. Together, ATDD + mutation testing form a "semantic
   firewall": agents can refactor and extend without intended behavior
   drifting.
3. **Discipline lives in deterministic tools, not prompt rules.** Instruction
   files erode; gates the agent must mechanically satisfy (test pipelines,
   architecture checks, thresholds) do not. Anything you care about must be a
   check the agent cannot talk its way past.
4. **Code-quality / change-risk analysis** — e.g. CRAP scores
   (cyclomatic complexity × coverage risk) on changed code, so complex,
   under-tested functions are flagged mechanically rather than left to
   reviewer stamina.
5. **The human stays the architect.** Specs and architecture decisions are
   human-approved artifacts; agent autonomy is tunable per task, and
   architecture-level changes always require sign-off.

### 1.4 The one-sentence version

> Confidence in agentic AI code comes from **independent, machine-checkable
> verification at every layer** — types, lint, unit, acceptance, E2E, mutation
> score, change-risk, dependency audit — enforced by deterministic gates the
> agent must satisfy (never just prompt rules), with **two test streams**
> (human-approved acceptance specs + unit tests) authored *before*
> implementation rather than as after-the-fact rationalizations.

---

## Part 2 — Where WoS+ stood at the start (audit, July 2026)

> **Historical.** This is the audit that motivated the plan, kept for the
> reasoning. It describes the repository *before* any phase landed. For current
> status see § Where this stands.

**Already strong:**

- ✅ Vitest 4 + happy-dom + coverage-v8 configured; 271 real passing unit tests
  (~80% stmts / 77% branch overall) that import the real modules via aliases.
- ✅ TypeScript strict mode (`astro/tsconfigs/strict`).
- ✅ Exact-pinned dependency versions + `pnpm install --frozen-lockfile` in CI.
- ✅ CI workflow runs build + tests on push/PR to `main`.
- ✅ Sentry wired up (client + server) for production feedback.
- ✅ `TESTING.md` documents conventions (AAA, one behavior per test, edge cases).

**Gaps (ordered by risk):**

- ❌ **`wos-words.ts` — the core dictionary/word-matching algorithm — is only
  ~34% covered** (`findAllMissingWords`, dictionary load paths untested). This
  is the module the copilot instructions themselves flag as dangerous to touch.
- ❌ **Integration tests are 28 `it.todo` placeholders** — zero real coverage of
  the 5 API routes (boards, words, channel-stats, health), which contain the
  input validation, CORS, and Supabase logic.
- ❌ **No linter at all** (`copilot-instructions.md`: "No linter configured").
- ❌ **Coverage is not gated** — no `coverage.thresholds`, and untested files
  (`wos-worker.ts`, `wos-widget.ts`, API routes, `cors.ts`) are silently
  excluded from the report because only imported files are counted.
- ❌ CI runs `pnpm test` (watch-mode script; only works in CI by accident of
  Vitest's CI detection) and never runs coverage, type-check, or lint.
- ❌ No mutation testing, no property-based testing, no E2E, no SAST/secret
  scanning, no dependency review.
- ❌ **`.github/copilot-instructions.md` states "No automated test suite
  exists: Manual testing required"** — factually wrong, and actively steers
  every AI agent away from the test suite. This is the cheapest high-impact
  fix in this entire plan.

---

## Part 3 — Implementation plan

> **Original plan, not status.** Phase descriptions here were written up front
> and deliberately not rewritten as work landed, so they still read as future
> work even where they are done. § Where this stands is the status.

Each phase is independently shippable, ordered by (confidence gained ÷ effort).
Every phase ends with a CI-enforced, agent-runnable gate.

### Phase 0 — Fix the foundation (hours)

1. **Correct the agent instructions.** Rewrite the Testing section of
   `.github/copilot-instructions.md` to describe the real suite, and add a
   `CLAUDE.md` at repo root with the agent contract:
   - Write or update tests **before** implementation for any behavior change;
     commit failing tests first when practical. Once Phase 3 lands: behavior
     changes start with a human-approved spec diff in `specs/`.
   - Never delete or weaken an existing test/assertion to make a change pass —
     flag it in the PR instead.
   - Never add a dependency without stating why in the PR; exact-pin it.
   - Before declaring done, run the full local gate:
     `pnpm run check && pnpm run lint && pnpm run test:coverage && pnpm run build`.
   - **Promote rules into tools.** Any recurring instruction in this file that
     can be a lint rule, script, or CI check becomes one — prompt rules erode;
     deterministic gates don't (Uncle Bob's core agentic-discipline principle).
2. **Make CI explicit and complete.** In `.github/workflows/tests.yml`:
   `pnpm test` → `pnpm run test:run --coverage`; add `pnpm run check`
   (new script: `astro check` for type-checking `.astro` + `.ts` — the current
   Cloudflare build does not type-check).
3. **Count every file in coverage.** In `vitest.config.ts`:
   ```ts
   coverage: {
     all: true,
     include: ['src/**/*.ts'],   // makes wos-worker.ts, api routes, etc. visible
     ...
   }
   ```
   Expect the headline number to drop — that drop is the real backlog.

**Gate:** CI = install → check → test:run + coverage → build. Agents have a
single documented command sequence to self-verify.

### Phase 1 — Static analysis gate (day 1–2)

1. Add **ESLint 9 (flat config)** with `typescript-eslint`
   `strictTypeChecked` + `eslint-plugin-astro`. Rules that specifically target
   AI failure modes:
   - `@typescript-eslint/no-explicit-any` (blocks the `any` escape hatch),
   - `@typescript-eslint/no-floating-promises` (unawaited async — a top AI bug
     in this codebase's worker/WebSocket patterns),
   - `@typescript-eslint/switch-exhaustiveness-check` (the WoS event-type
     `switch` in `wos-worker.ts` / `startEventProcessors()`),
   - `no-restricted-imports` to keep worker/browser boundaries clean.
2. Run with **`--max-warnings 0`** in CI so agent-introduced warnings block
   merge instead of accumulating.
3. Baseline pragmatically: auto-fix what's safe, add targeted
   `eslint-disable` with justification comments for the rest, then ratchet.

**Gate:** `pnpm run lint` green with zero warnings, required in CI.

### Phase 2 — Coverage floor + ratchet (day 2–3)

1. Add thresholds to `vitest.config.ts` at *just below current reality* so CI
   goes green on day one, then ratchet upward with the codebase:
   ```ts
   coverage: {
     thresholds: {
       statements: 78, branches: 75, functions: 71, lines: 80,
       // per-file floor for the crown jewels:
       'src/scripts/wos-words.ts': { statements: 90, branches: 85 },
       'src/lib/**': { statements: 90 },
     },
   }
   ```
2. **Policy (in CLAUDE.md): thresholds only go up.** An agent PR that adds code
   must keep coverage at or above the floor; raising a threshold is a
   deliberate, reviewed act. Target: 85/80/85/85 global within a quarter —
   the AI-era bar, not the legacy 70–80% one.
3. Close the two worst gaps immediately (this is mostly writing tests for
   existing behavior, an ideal agent task *because the spec is "current
   behavior," verifiable by a human*):
   - `wos-words.ts`: `findAllMissingWords`, dictionary load/failure paths.
   - `wos-worker.ts`: table-driven tests over recorded WoS event fixtures
     (all 12 event types → expected postMessage output).

**Gate:** `vitest run --coverage` fails the build below thresholds.

### Phase 3 — The acceptance-test stream (ATDD, per Uncle Bob) (week 1)

This is not just "fill in the integration tests" — it establishes the
**second test stream**: acceptance tests as a human-approved behavioral
contract, distinct from the unit stream. Both streams must be green for any
change to land; an agent cannot satisfy the acceptance stream by writing unit
tests around whatever it happened to build.

1. **Write the specs first, in domain language.** Create `specs/` with one
   markdown spec per behavior area, in Given/When/Then form, written in WoS
   terms (levels, slots, letters, guesses, boards, clears) with no
   implementation detail. Seed them from what the system already does — the
   28 existing `it.todo` titles are a starting outline — and have the human
   maintainer approve them. From then on, **new features start with a spec
   diff the human approves before implementation** (spec → tests → code).
2. **Encode them as executable acceptance tests** in `tests/acceptance/`
   (plain Vitest `describe`/`it` mirroring the Gherkin phrasing — no need
   for cucumber-js overhead at this project's size; each test cites its spec
   section). Two suites:
   - **API behavior**: invoke the exported `APIRoute` handlers directly with
     a constructed `Request` and mocked `locals.runtime.env`, via a shared
     harness (`tests/acceptance/api-harness.ts`) that fabricates Astro's
     `APIContext`. Assert on the `Response` — status, headers, JSON body.
   - **Game behavior**: fixture-driven scenarios through `GameSpectator` +
     workers — recorded WoS event sequences in, observable UI/state out
     ("Given a level starts with letters …, when a correct guess event
     arrives for slot 3, then slot 3 shows the word and the guesser").
3. Mock the network **at the boundary, not the module**: **MSW (Mock Service
   Worker)** intercepts the Supabase REST calls the `@supabase/supabase-js`
   client makes, so the real client code (query building, error mapping) is
   exercised. Same for the `clarkio.com/wos-dictionary` fetch.
4. Cover per API route: happy path, validation rejections (bad board id,
   oversized payloads, non-alpha words), Supabase error propagation, CORS
   headers (`cors.ts` is currently at 0%), and correct status codes.
5. Keep deterministic: fake timers where timing matters, zero real network
   (fail the suite on unmatched MSW requests).

**Gate:** acceptance suite is a separate required CI step (`test:acceptance`)
so both streams are independently visible; the `it.todo` count for API routes
is 0; PRs that change behavior must touch `specs/` (checklist item, enforced
by review).

### Phase 4 — Property-based tests for the algorithmic core (week 2)

Add **fast-check** and encode *invariants* for the code where example-based
tests are weakest:

- `findWosWordsByLetters(letters)`:
  - every returned word is buildable from `letters` (letter-frequency check —
    the inverse implementation, written independently in the test),
  - result is a subset of the dictionary,
  - permutation invariance: shuffling `letters` yields the same result set,
  - adding a letter never *removes* previously-found words.
- `findAllMissingWords(knownLetters, minLength)`: no returned word shorter than
  `minLength`; no returned word already guessed.
- `board-utils` normalizers (`normalizeTwitchChannel`, `normalizeLanguageCode`):
  idempotence (`f(f(x)) === f(x)`) and output-alphabet invariants.
- `mirror-url` round-trip: `getMirrorGameId(normalizeMirrorUrl(id)) === id`
  for all generated UUIDs.

These invariants are exactly what surfaces the plausible-but-wrong logic that
agents produce and example tests overfit around.

**Gate:** fast-check suites run in the normal `vitest` run (bounded run count,
seeded for reproducibility; failing seeds get pinned as regression tests).

### Phase 5 — Mutation testing + change-risk analysis: verify the tests themselves (week 2–3)

This is the third layer of Uncle Bob's stack: acceptance tests verify *what*,
unit tests verify *how*, mutation testing verifies the tests **actually catch
bugs** — together forming the "semantic firewall" that lets agents refactor
without behavior drifting.

1. Add **StrykerJS** with `@stryker-mutator/vitest-runner`.
2. Scope initially to the pure-logic modules where mutants are meaningful and
   runs are fast: `src/lib/**`, `src/scripts/wos-words.ts`,
   `src/scripts/mirror-url.ts`, `src/scripts/board-utils` paths.
3. Use **incremental mode** in PR CI (mutates only changed code — fast enough
   per-PR) plus a **weekly scheduled full run** publishing the HTML report.
4. Thresholds: start `break` at the measured baseline; policy target ≥ 70
   mutation score on scoped modules, ratcheting like coverage.
5. **Policy:** a surviving mutant on lines an AI-authored PR touched means the
   PR's tests don't actually constrain the new code — add assertions, don't
   suppress.
6. **Change-risk (CRAP) analysis.** Flag complex, under-tested functions
   mechanically: ESLint's `complexity` rule caps cyclomatic complexity
   (baseline generously against `GameSpectator`'s current methods, then
   ratchet), combined with the per-file coverage floors from Phase 2 this
   approximates CRAP scoring (complexity × coverage risk) with zero new
   tooling. A function that is both complex and poorly covered blocks merge
   instead of relying on reviewer stamina to notice it.

**Gate:** `pnpm run test:mutation` — incremental in PRs, full weekly, score
thresholds enforced by Stryker's `thresholds.break`.

### Phase 6 — Thin E2E smoke layer (week 3)

Per the trophy: *thin*. A handful of Playwright tests against the built app
(`astro build` + `wrangler dev`), Chromium only:

- `/`, `/player`, `/streamer` load without console errors,
- missing query params open the settings dialog (documented critical behavior),
- settings dialog round-trips values into URL params,
- `/api/health` returns 200 through the real Workers runtime (catches
  `prerender = false` / `locals.runtime.env` misconfigurations that unit tests
  structurally cannot).

WoS WebSocket and Twitch chat stay out of scope (external live services);
their protocol handling is covered by the fixture-driven worker tests from
Phase 2.

**Gate:** `pnpm run test:e2e` as a separate required CI job.

### Phase 7 — Security & supply-chain gates (week 3–4)

1. **CodeQL** workflow (javascript-typescript) on PRs + weekly schedule.
2. **GitHub dependency review action** on PRs — flags known-vuln and
   newly-introduced packages; combined with exact pinning + frozen lockfile
   (already in place) this closes the slopsquatting/hallucinated-package hole.
   Policy in CLAUDE.md: agents must justify any new dependency; humans verify
   the package is the real, established artifact before merge.
3. **Secret scanning**: enable GitHub secret scanning + push protection; add
   `gitleaks` to CI for defense in depth (Supabase keys are the live risk).
4. `pnpm audit --prod` in CI (non-blocking report initially; blocking for
   high/critical after triage).

**Gate:** CodeQL + dependency review + secret scan required on PRs.

### Phase 8 — Branch protection & the agent workflow contract (ongoing)

1. **Branch protection on `main`**: require the check/lint/test/build jobs (and
   later mutation + E2E) to pass; require PRs; no direct pushes.
2. **The human stays the architect.** Agent autonomy is scoped per task:
   behavior changes require an approved spec diff (Phase 3); architecture
   changes (new modules, data flows, dependencies, worker boundaries) require
   explicit maintainer sign-off before implementation, regardless of how
   confident the agent is. Bug fixes and refactors inside existing structure
   can proceed autonomously against the existing gates.
3. **PR template** with an AI-disclosure + verification checklist:
   - [ ] Spec in `specs/` added/updated for any behavior change
   - [ ] Tests written/updated *before or with* the implementation
   - [ ] `pnpm run check && lint && test:coverage && build` pass locally
   - [ ] No existing test weakened or deleted (or explicitly justified)
   - [ ] New dependencies: none / listed with justification
   - [ ] Code authored with AI assistance: yes/no (routes reviewer attention —
     review AI code as untrusted-contributor code, focusing on edge cases,
     error handling, and boundaries)
4. **Keep instruction files load-bearing**: `CLAUDE.md` /
   `copilot-instructions.md` are updated in the same PR as any change to
   scripts, gates, or conventions — stale agent instructions are a defect
   class of their own (see the current "no test suite exists" line).
5. **Close the loop in production**: tag Sentry releases per deploy so
   regressions are attributable to specific merges; a spike after an
   agent-authored merge feeds back into which gate should have caught it.

---

## Part 4 — Target end state

```
            Layer                Tool                     CI gate
  ┌───────────────────────┐
  │  E2E (thin)           │  Playwright + wrangler     required job
  ├───────────────────────┤
  │  Acceptance (fat)     │  specs/ (Given/When/Then)  required job,
  │                       │  → Vitest + MSW harness    human-approved specs
  ├───────────────────────┤
  │  Unit + property      │  Vitest + fast-check       coverage ≥ 85/80/85/85
  ├───────────────────────┤
  │  Test-quality         │  StrykerJS                 incremental PR + weekly,
  │                       │                            score ≥ 70 on core
  ├───────────────────────┤
  │  Static               │  astro check, tsc strict,  --max-warnings 0
  │                       │  ESLint strictTypeChecked
  ├───────────────────────┤
  │  Security/supply      │  CodeQL, dep review,       required on PR
  │                       │  gitleaks, pnpm audit
  └───────────────────────┘
        + agent contract (CLAUDE.md): test-first, gates runnable locally,
          no test-weakening, dependency justification
        + Sentry release health closing the production loop
```

**Definition of done for the whole plan:** an agent (or human) cannot land a
change on `main` unless a human-approved acceptance spec covers its behavior,
both test streams (acceptance + unit) are green, every static/dynamic gate
passes, the tests themselves are proven meaningful by mutation score, and
nothing new entered the supply chain unreviewed.

---

## Sources

**Uncle Bob's agentic discipline (the workflow this plan aligns to):**

- [Uncle Bob Martin on X — agentic AI coding workflow](https://x.com/unclebobmartin/status/2080257779395154409)
- [Uncle Bob Martin on X — Agentic Discipline video series announcement (cleancoders.com)](https://x.com/unclebobmartin/status/2026746465742180595)
- [O'Reilly — AI Agents for Clean Code with "Uncle Bob" Martin](https://www.oreilly.com/live-events/ai-agents-for-clean-code-with-uncle-bob-martin/0642572376765/)
- [swingerman/disciplined-agentic-engineering — ATDD for Claude Code, inspired by Uncle Bob's approach](https://github.com/swingerman/disciplined-agentic-engineering)
- [Emily Bache — Test-Driven Development with Agentic AI](https://coding-is-like-cooking.info/2026/03/test-driven-development-with-agentic-ai/)
- [DevAssure — Why TDD is having a second act in the age of AI coding agents](https://www.devassure.io/blog/tdd-second-act-ai-coding-agents/)

**General research:**

- [Anthropic — Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- [Anthropic — Building verification loops in Claude Code with skills](https://claude.com/blog/building-verification-loops-in-claude-code-with-skills)
- [Anthropic — Loop engineering: getting started with loops](https://claude.com/blog/getting-started-with-loops)
- [DataCamp — Claude Code best practices: planning, context transfer, TDD](https://www.datacamp.com/tutorial/claude-code-best-practices)
- [Skyramp — Testing AI-generated code: best practices for 2026](https://skyramp.dev/blog/testing-ai-generated-code)
- [TwoCents — How to test AI-generated code the right way in 2026](https://www.twocents.software/blog/how-to-test-ai-generated-code-the-right-way/)
- [ContextQA — How to test AI-generated code: a QA checklist for 2026](https://contextqa.com/blog/what-is-ai-generated-code-testing-checklist/)
- [Bright Security — 5 best practices for reviewing AI-generated code safely](https://brightsec.com/blog/5-best-practices-for-reviewing-and-approving-ai-generated-code/)
- [SourceTrail — Validating AI-generated code: best practices and tools](https://www.sourcetrail.com/software/how-to-validate-and-verify-ai-generated-code/)
- [Augment Code — Mutation testing for AI-generated code: a practical guide](https://www.augmentcode.com/guides/mutation-testing-ai-generated-code)
- [TaskBounty — Mutation testing for JavaScript with Stryker](https://www.task-bounty.com/blog/mutation-testing-javascript-stryker)
- [QASkills — Mutation testing with Stryker: complete guide 2026](https://qaskills.sh/blog/mutation-testing-stryker-guide-2026)
- [Kent C. Dodds — The Testing Trophy and testing classifications](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications)
- [Kent C. Dodds — Static vs unit vs integration vs E2E testing](https://kentcdodds.com/blog/static-vs-unit-vs-integration-vs-e2e-tests)
- [Digital Applied — Software testing strategy 2026: the engineering guide](https://www.digitalapplied.com/blog/software-testing-strategy-2026-engineering-reference)
- [Motomtech — Quality gates for AI-generated code: lint, test, scan, review](https://www.motomtech.com/blog-post/ai-generated-code-quality-gates/)
- [Orca Security — Best AI code security solutions 2026](https://orca.security/resources/blog/best-ai-code-security-solutions/)
- [Cloud Security Alliance — Vibe coding's security debt: the AI-generated CVE surge](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-generated-code-vulnerability-surge-2026/)
- [ClackyAI — Code review checklist for AI-generated code](https://clacky.ai/blog/code-review-checklist-ai-generated-code)
- [goldbergyoni/javascript-testing-best-practices](https://github.com/goldbergyoni/javascript-testing-best-practices) (already referenced by TESTING.md)
