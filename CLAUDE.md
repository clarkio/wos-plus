# CLAUDE.md — Agent guide for WoS+

This file is the contract for AI coding agents working in this repository. Read
it before making any change.

It is deliberately short and normative. Deep architectural detail lives in
[.github/copilot-instructions.md](.github/copilot-instructions.md), and testing
conventions live in [TESTING.md](TESTING.md) — read those rather than expecting
them to be repeated here.

> **Maintenance note:** this file is edited incrementally by several agents
> across phases of the testing/quality plan. Append new material under its own
> `##` heading rather than rewriting existing sections, and keep the section
> order below stable so diffs stay reviewable.

---

## 1. Project orientation

**WoS+** is a real-time enhancement tool for the Twitch game "Words on Stream".
It ships two views — a **player view** and an OBS-ready **streamer view** — built
with **Astro + TypeScript** and deployed to **Cloudflare Pages/Workers**.

The shape you need to know before touching code:

| Area | Where | Notes |
| --- | --- | --- |
| Game state orchestration | `src/scripts/wos-plus-main.ts` | `GameSpectator` class; slot-based level state |
| Web Workers | `src/scripts/wos-worker.ts`, `src/scripts/twitch-chat-worker.ts` | `postMessage` only; no DOM, no shared state |
| Dictionary / word matching | `src/scripts/wos-words.ts` | The crown jewels. Highest-risk module, lowest coverage. |
| Twitch channel names | `src/scripts/twitch-channel.ts` | Canonical normalization and 1–50 character validation |
| API routes | `src/pages/api/**` | Must `export const prerender = false`; env via `locals.runtime.env`; CORS via `src/lib/cors.ts` |
| Shared helpers | `src/lib/**` | Board validation in `board-utils.ts`; API responses in `api-utils.ts`; Supabase clients in `supabase.ts`; CORS in `cors.ts` |
| Tests | `tests/unit/`, `tests/acceptance/`, `tests/property/` | Vitest 4 + happy-dom; setup in `tests/setup.ts`. Two streams — see §7 |
| E2E smoke | `tests/e2e/` | Playwright, against a real `wrangler dev` runtime. Separate from Vitest — see §9 |
| Behavioural contract | `specs/` | Human-owned. Acceptance tests cite it; open questions indexed in [specs/README.md](specs/README.md) |
| **Where the quality plan stands** | [AGENTIC-TESTING-PLAN.md § Where this stands](AGENTIC-TESTING-PLAN.md) | Phase-by-phase status, what to do next, and the 13-issue behaviour backlog. **Start here if picking the work up cold.** |

Full architecture, data flows, conventions, and known pitfalls:
[.github/copilot-instructions.md](.github/copilot-instructions.md).

Package manager is **pnpm** (`packageManager` field is authoritative). Use
`pnpm install --frozen-lockfile`.

---

## 2. Agent contract

These rules are binding. If following one is impossible for a given change, say
so explicitly in the PR description — do not silently work around it.

### 2.1 Tests come first

- **Write or update tests BEFORE the implementation** for any behavior change.
  When practical, commit the failing tests first, then the change that makes
  them pass. The commit history should show the test defining the behavior.
- A bug fix starts with a test that reproduces the bug.
- New behavior with no test is not done.

### 2.2 Never weaken the safety net

- **Never delete, skip, `.todo`, or loosen an existing test or assertion to make
  a change pass.** If an existing test genuinely encodes wrong behavior, leave
  it failing and **flag it in the PR** with your reasoning so a human decides.
- Same rule for gates: do not lower a coverage threshold, disable a CI step, add
  a blanket `eslint-disable`, or widen an ignore list to get green. Narrow,
  justified, commented suppressions are the only acceptable form.

### 2.3 Dependencies

- **Never add a dependency without justifying it in the PR** — what it does, why
  a hand-rolled alternative is worse, and its maintenance status.
- **Exact-pin every version.** This repo pins exactly (`"astro": "7.0.9"`, not
  `"^7.0.9"`). Match that convention; use `pnpm add --save-exact`.
- Commit the updated `pnpm-lock.yaml` in the same change.

### 2.4 The local gate

Run this before declaring any work done, and paste the real results in the PR:

```bash
pnpm run check && pnpm run lint && pnpm run test:coverage && pnpm run build
```

- `pnpm run check` — `astro check`, type-checks `.astro` + `.ts` (the Cloudflare
  build does not type-check).
- `pnpm run test:coverage` — full suite, single run, with coverage. This
  **includes** the acceptance stream (§7) and the property stream, so the one
  command covers both streams. `pnpm run test:acceptance` runs that subset
  alone when you want the contract checked on its own.
- `pnpm run build` — production build.

Note: `pnpm test` is **watch mode**. Never use it in CI or in an agent loop; use
`pnpm run test:run`.

> `pnpm run lint` runs ESLint at `--max-warnings 0`. Pre-existing findings are
> recorded in `eslint-suppressions.json` as a **ratchet baseline**: a new
> violation is not suppressed and fails the build. Shrink that file; never
> regenerate it wholesale to absorb a new violation.

CI ([.github/workflows/tests.yml](.github/workflows/tests.yml)) runs the same
sequence: install → check → lint → **acceptance** → test + coverage → build. The
acceptance step is a deliberate subset of the one after it, so the two test
streams get separate lines in the CI output. It stays inside the single `build`
job because `docs/BRANCH-PROTECTION.md` lists required checks by job name and a
new job would silently not be required.

The workflow's `pull_request` trigger carries **no `branches:` filter** on
purpose. With one, a stacked PR — targeting a feature branch rather than `main`
— runs no tests at all and looks green because only third-party checks report
(this happened on PR #159). Do not re-add the filter.

### 2.5 Promote rules into tools

**Prompt rules erode; mechanical gates do not.** Any recurring instruction in
this file or in review feedback that *could* be enforced deterministically
should become a lint rule, a script, or a CI check — and then the prose should
point at the tool instead of restating the rule.

When you notice yourself (or a reviewer) repeating the same correction:

1. Encode it — an ESLint rule, a `package.json` script, a CI step, a test.
2. Wire it into the gate in §2.4 and into CI.
3. Reduce the prose here to a one-line pointer at the enforcing tool.

Prefer a failing build over a paragraph of good advice.

---

## 3. Scope discipline

- Do not fix unrelated pre-existing errors while doing a scoped task. Report
  them; let a human decide.
- Do not introduce tooling belonging to another phase of the quality plan
  (linting, coverage thresholds, E2E, mutation testing) unless that is the task.
- Keep changes reviewable: one concern per PR.

---

## 4. Known state (keep current)

- Test suite: **736 passing** Vitest tests across 22 files, plus **3
  `it.todo`**. Every remaining todo is a **known gap with a tracking issue or a
  stated coverage limitation** — none is simply an unwritten test, and none may
  be deleted to tidy the count. The decisions behind them are tabulated in
  [specs/README.md § Decisions from the #160 review](specs/README.md).
  - **There are no open spec questions right now.** Every ❓ raised while
    writing the specs was answered in that review. The ❓ marker and its index
    stay — they are the mechanism for the next batch, not a leftover.
- ~~28 `it.todo` placeholders in `tests/integration/api-routes.test.ts`.~~
  **Gone** — every one of those API-route placeholders is now covered by a real
  test in `tests/acceptance/`, so the stub file and the empty
  `tests/integration/` directory were deleted rather than left as a decoy.
- `pnpm run check` is **clean** (0 errors, 0 warnings; some hints remain).
- Coverage: **91.95% statements / 88.07% branches / 89.34% functions /
 92.64% lines**. It counts **all** files under `src/**/*.ts`, so an untested
  module appears at 0% instead of being invisible.
  - `src/pages/api/**`, `src/lib/cors.ts` and `src/lib/board-utils.ts` are at
    **100%**, covered by the acceptance stream.
  - `src/scripts/wos-widget.ts` is still at **0%** — the one module no test
    imports.
  - **Thresholds are enforced** (`vitest.config.ts` `coverage.thresholds`,
    landed with [#155](https://github.com/clarkio/wos-plus/issues/155)):
    global floor statements 91 / branches 86 / functions 88 / lines 91, plus
    per-file floors for `src/scripts/wos-words.ts` (96/90/94/98) and
    `src/lib/**` (86/63/100/91, set by `launch-menu.ts`, the weakest file
    there — `cors.ts` and `board-utils.ts` are both at 100%). Per-file
    thresholds apply to each matching file individually, not aggregated.
    **Ratchet-only policy**: thresholds only go up. A PR that adds code keeps
    coverage at or above the floor it lands against; lowering a threshold is
    a deliberate, reviewed act justified in the PR, never a shortcut to green.
    Quarterly target stays 85/80/85/85 global. Details in
    [TESTING.md § Coverage](TESTING.md#coverage).
- ~~Known coverage-tooling gap: the four API routes importing
  `cloudflare:workers` are dropped from coverage.~~ **Fixed** — the specifier is
  aliased to `tests/stubs/cloudflare-workers.ts` in `vitest.config.ts`.
  Historical baselines, for context on how far the number has moved: 79.97%
  was reported before untested files were counted at all; 63.45% was the honest
  figure once they were.
- ESLint 9 flat config (`eslint.config.js`), type-aware, enforced at
 `--max-warnings 0`. **61** pre-existing violations across 15 files are
  suppressed via `eslint-suppressions.json` (down from 68) and should keep
  being burned down; the
  `no-unsafe-*` family is downgraded repo-wide pending real payload types.
  `no-explicit-any`, `no-floating-promises`, and `switch-exhaustiveness-check`
  are hard errors on all new code.


---

## 5. Autonomy: who decides what

Not every change carries the same risk, and the gates alone don't encode that.
Three tiers:

- **Bug fixes and refactors inside existing structure** — proceed
  autonomously. The gates in §2.4 are the check.
- **Behavior changes** — start with a spec diff in `specs/` that a human
  approves *before* implementation. The spec is the contract; the acceptance
  tests encode it; the implementation satisfies it. (Lands with the acceptance
  stream — until then, describe the intended behavior change in the PR and get
  agreement first.)
- **Architecture changes** — new modules, new data flows, new dependencies,
  changes to worker boundaries — require explicit maintainer sign-off before
  implementation, regardless of how confident you are. Agent confidence is not
  evidence.

The human stays the architect. When a task is ambiguous about which tier it
falls into, treat it as the higher one and ask.

## 6. Keep these instructions load-bearing

`CLAUDE.md` and `.github/copilot-instructions.md` must be updated **in the same
PR** as any change to scripts, gates, or conventions.

Stale agent instructions are their own defect class. The cautionary example is
in this repository's own history: `copilot-instructions.md` told every agent
"**No automated test suite exists**: Manual testing required" while 271 tests
were passing in CI. Every agent that read it was steered away from the suite.

If you change a command, a gate, or a convention and don't update these files,
you have introduced a bug that no test will catch.

---

## 7. The acceptance stream (`tests/acceptance/`)

The second test stream (AGENTIC-TESTING-PLAN.md Phase 3). Unit tests describe
what the code does; acceptance tests encode the human-approved behavioural
contract in [specs/](specs/). Both must be green.

```bash
pnpm run test:acceptance     # vitest run tests/acceptance
```

It is a **subset** of `pnpm run test:run` / `test:coverage`, not a separate
suite — the script exists so the stream is independently visible. The §2.4 gate
already covers it.

Conventions, all enforced by the harness rather than by this prose:

- One file per behaviour area, named `*.acceptance.test.ts`; each `describe`
  cites the `specs/` section it implements.
- Start every file with `// @vitest-environment node` — the repo default is
  happy-dom, but these exercise server code.
- **Invoke the route, don't serve it.** `invokeRoute(GET, { … })` from
  [tests/acceptance/api-harness.ts](tests/acceptance/api-harness.ts) fabricates
  Astro's `APIContext`, including route `params`, `locals.runtime.env`, and the
  module-level `env` from `cloudflare:workers` that the routes actually read
  their credentials from.
- **Mock the network at the boundary, never the module.** Declare Supabase
  responses with the helpers in
  [tests/acceptance/network-mock.ts](tests/acceptance/network-mock.ts) so the
  real `@supabase/supabase-js` query building and error mapping still run.
  `vi.mock('@supabase/supabase-js')` in this tree defeats the point of it.
- **Zero real network.** An unmatched request is answered locally and recorded,
  and the recording is asserted empty after every test. Note that MSW's
  `onUnhandledRequest: 'error'` alone does *not* achieve this — it logs, but in
  msw 2.15.0 the request still reaches the real network. The catch-all handler
  and the `afterEach` recorder assertion are what actually keep the suite
  offline; **removing either fails no test and silently un-hermetics the
  suite**. See the header comment in `network-mock.ts` and
  [TESTING.md](TESTING.md#the-acceptance-stream).

### Open questions are not yours to close

A spec scenario marked ❓ **Unconfirmed** is a question addressed to the
maintainer, not approved behaviour. Where the behaviour is reachable it is
pinned by a test asserting *current behaviour under protest*; where it is not,
it is an `it.todo` naming the question. Every one of them is indexed in
[specs/README.md § Open questions](specs/README.md).

- Do not resolve one, and do not remove its marker, without a maintainer's
  answer.
- Do not delete a deliberate `it.todo` to make the count nicer. None of the 8
  remaining is an unwritten test. The one narrow exception already taken: when a
  maintainer **retires** the spec scenario a todo names, the todo goes with it —
  a todo pointing at a scenario that no longer exists is worse than none. That
  is a spec change, not a tidy-up, and it belongs in the same PR as the spec
  edit.
- If your change makes a pinned test fail, that is the mechanism working: the
  question now has to be answered in the same PR, not silently settled.

### The other two markers

Once a maintainer answers, the scenario is rewritten to say what *should* happen
and takes one of two further markers. Both are decisions; neither is an
invitation to re-open the discussion.

| Marker | Meaning | What the test beside it does |
| --- | --- | --- |
| ⚠️ **Approved, not yet implemented** | Decided; WoS+ does not do it yet. Always names a tracking issue. | Still pins **current** behaviour, named `known gap (#N)` |
| ✅ **Confirmed (maintainer)** | Current behaviour was deliberate; the reasoning is recorded | Pins it as intended |

A ⚠️ test is the one to understand before you touch it. It asserts behaviour the
maintainer has already ruled **wrong**, on purpose, so that implementing the fix
cannot happen quietly. When you land the change, **invert the assertion in that
same PR** — never delete it first to get green, which §2.2 forbids outright. A
red ⚠️ test is the system working exactly as designed.

The decisions taken so far, with their issues, are tabulated in
[specs/README.md § Decisions from the #160 review](specs/README.md).

---

## 8. Mutation testing (`stryker.config.json`)

Coverage proves code was *executed*; it does not prove the tests would fail if
the code were wrong. StrykerJS closes that gap by mutating the source
(`>` → `>=`, `+` → `-`, boolean flips, …) and checking whether the suite
notices — AGENTIC-TESTING-PLAN.md Phase 5 / issue #154.

- **Scope is deliberately narrow**: `src/lib/**`, `src/scripts/wos-words.ts`,
  `src/scripts/mirror-url.ts`, `src/scripts/twitch-channel.ts` — pure-logic
  modules where a mutant's meaning is unambiguous and runs stay fast.
  `wos-plus-main.ts` (DOM-coupled orchestration) is explicitly out of scope;
  mutating it would make runs unusably slow for what it would tell you.
- **`pnpm run test:mutation`** runs the full scoped suite locally
  (`stryker run`, ~2.5 minutes). It is **not** part of the §2.4 local gate or
  the CI `tests.yml` job — a mutation run is much slower than the rest of the
  gate and would break the fast feedback loop the other checks depend on.
- **CI** (`.github/workflows/mutation.yml`) runs it two ways, neither a
  required status check yet: an **incremental** run
  (`stryker run --incremental`, only mutants on lines a PR touched) on every
  pull request, using a GitHub Actions cache for the incremental result file
  so each run builds on the last; and a **full** run on a Monday schedule (or
  manual dispatch) that uploads the HTML report as a workflow artifact.
- **Thresholds are measured, not guessed** (`stryker.config.json`
  `thresholds.break`). The baseline landing with #154 was 79.31% overall
  (board-utils.ts 94.85, cors.ts 93.18, launch-menu.ts 43.28, mirror-url.ts
  94.23, twitch-channel.ts 61.11, wos-words.ts 72.19); `break` is set to 79,
  just below that number, the same ratchet-only policy as coverage in §4 —
  raise it as survivors get killed, never lower it to get green.
- **Policy: a surviving mutant on lines a PR touches means that PR's tests
  don't actually constrain the new code.** Add an assertion that would catch
  the mutant; do not suppress it, and do not treat "coverage is fine" as a
  substitute for "the test would fail if this line were wrong."
- **Change-risk guardrail**: `eslint.config.js` enforces the core `complexity`
  rule at a generous ceiling of 32 (baselined against `saveBoard` in
  `db-service.ts`, the codebase's current worst offender at 31) so it doesn't
  fail on existing code. Combined with the per-file coverage floors in
  `vitest.config.ts`, a function that is both complex *and* under-tested gets
  flagged by two independent mechanical signals instead of relying on
  reviewer stamina. Ratchet the ceiling down as complex methods (this one,
  and `GameSpectator.updateGameState` at 29) get decomposed — never raise it
  to accommodate new complexity. **Tracked in
  [#193](https://github.com/clarkio/wos-plus/issues/193)** — unlike the
  coverage ratchet (quarterly target above) and the mutation-score ratchet
  (target ≥70), this one had no tracked goal until #193; that issue is now
  the source of truth for the decomposition work and the next ceiling number.
- `reports/` and `.stryker-tmp/` are generated and gitignored; CI publishes
  the HTML report as an artifact instead of committing it.

---

## 9. Thin E2E smoke layer (`tests/e2e/`, `playwright.config.ts`)

The last layer of the Testing Trophy (AGENTIC-TESTING-PLAN.md Phase 6 /
issue #152): a handful of Playwright tests against a real production build
running under `wrangler dev` — the only layer that catches `prerender =
false` / `locals.runtime.env` misconfigurations, since unit and acceptance
tests invoke route handlers directly and never touch an actual Workers
runtime.

- **`pnpm run test:e2e`** runs the suite (`playwright test`). It is **not**
  part of the §2.4 local gate — like mutation testing, it's a separate,
  slower layer with its own CI job (`.github/workflows/e2e.yml`, job `e2e`),
  not bundled into `build`.
- **Deliberately narrow, per the plan's "thin E2E" framing**: page loads for
  `/`, `/player`, `/streamer`, `/bot`, `/bot/setup` without unexpected console
  errors; the post-authorization chatbot setup steps on `/bot/setup`
  (issue [#178](https://github.com/clarkio/wos-plus/issues/178)); `/api/health`
  returning 200 through the real Workers runtime; the settings dialog opening
  when required query params are missing; and the dialog's Save flow
  round-tripping values into URL params. WoS WebSocket and Twitch chat
  connections are explicitly **out of scope** — that protocol handling is
  already covered deterministically by the fixture-driven worker tests
  (`tests/unit/wos-worker.test.ts`, `tests/unit/twitch-chat-worker.test.ts`).
- **One deliberate exception to "thin"**:
  `tests/e2e/view-controller.spec.ts` is *characterization* coverage, not
  smoke — required-parameter gating, `board`/`chat` visibility handling, board
  iframe load/clear, and settings-form pre-population, on both `/player` and
  `/streamer`. It exists because those two pages carry ~630 duplicated lines
  with no other test coverage at all, and
  [#128](https://github.com/clarkio/wos-plus/issues/128) will deduplicate
  them; it is the safety net that refactor needs. It has to live at this layer
  rather than in Vitest because both pages' client code is an inline
  `<script>` block inside the `.astro` file, so there is no module to import —
  extracting one is itself part of #128. **Fold it back into the unit stream
  once that extraction lands**; it is not a licence to grow the E2E layer
  generally.
- **Two of its tests pin drift between the two views on purpose** — `/player`
  echoes invalid query parameters back into the settings dialog while
  `/streamer` discards them, and the chat/board toggles exist only in
  player's form. Both are open questions on #128, pinned as *current
  behaviour under protest* in the same spirit as the ⚠️ acceptance tests in
  §7. Deduplicating the views will force one behaviour on both, so the
  matching test must be **updated in the same PR as the fix**, never deleted
  to get green (§2.2).
- **Hermetic by the same convention as the acceptance stream** (§7): zero
  reliance on real third-party network reachability. `tests/e2e/e2e-harness.ts`
  aborts Google Fonts, Twitch's GQL lookup and the WoS mirror board
  (`wos.gg`) over HTTP (`blockExternalNetwork`), and separately mocks the WoS
  mirror socket (`wos2.gartic.es`) via `page.routeWebSocket` — the settings
  dialog's Save flow opens that connection as a raw WebSocket (socket.io with
  `transports: ['websocket']`, no HTTP fallback), which `page.route` cannot
  intercept. Neither depends on whether those hosts happen to be reachable in
  a given CI or sandbox network policy.
- **The policy is pinned in the unit stream, not only end-to-end**
  (`tests/unit/e2e-harness.test.ts`, added with
  [#203](https://github.com/clarkio/wos-plus/issues/203)). Whether a host is
  reachable from a given sandbox is not something a test about *policy* should
  depend on: in a fully offline sandbox every host looks blocked whether the
  harness blocks it or not, so a browser-driven assertion passes for the wrong
  reason — which is exactly how the `wos.gg` gap survived being noticed. When
  adding a host to `BLOCKED_HOSTS`, note that the same list drives
  `isKnownExpectedFailureUrl`: a host that is aborted but *not* treated as an
  expected failure surfaces as an unexpected one and fails every smoke test.
- **A named, not hidden, gap**: `e2e.yml` provisions no Supabase credentials,
  so `/player`/`/streamer`'s in-page word-dictionary and channel-stats
  fetches fail the same way they would locally without `.dev.vars` — the
  routes already catch and log rather than throw, so pages still render.
  `e2e-harness.ts`'s `collectUnexpectedFailures` names this exact known gap,
  scoped by URL rather than by message text: Chrome's own resource-failure
  console messages are generic and carry no URL, and console events aren't
  guaranteed to arrive in a correlated order with the network events that do
  carry one, so the two are judged independently rather than one "forgiving"
  a count against the other — a page-global counter was tried and rejected in
  review (PR #194) for exactly that ordering risk (an unrelated failure could
  consume budget left over from an earlier expected one and go unreported).
  Generic resource-failure console text is dropped outright since it can't be
  attributed to a URL; `unexpectedRequestFailures` is the real check, built
  from `requestfailed`/`response` events (which do carry a URL) against the
  known-expected list (the blocked hosts above, `/api/words`,
  `/api/channel-stats/*`) — an unrelated failing request still surfaces there
  regardless of what else failed first. Wiring real or sandboxed Supabase
  credentials into the CI
  job is future work; it isn't required for this suite to be a meaningful
  gate, since its actual target is Workers-runtime wiring and page/dialog
  behavior, not Supabase-backed data.
- **Browser**: `@playwright/test` 1.62.1, exact-pinned. `playwright.config.ts`
  uses `127.0.0.1` rather than `localhost` for `baseURL` and the `webServer`
  health-check URL — `wrangler dev` only binds IPv4, and some sandboxes
  resolve `localhost` to `::1` first, which hangs. Locally, set
  `PLAYWRIGHT_CHROMIUM_PATH` to reuse a preinstalled Chromium instead of
  downloading one (this also gates `--no-sandbox`, needed only when Chromium
  runs as root); CI installs its own via
  `pnpm exec playwright install --with-deps chromium` and leaves that env var
  unset.
- `playwright-report/` and `test-results/` are generated and gitignored; CI
  uploads the HTML report as a workflow artifact on failure instead of
  committing it.
- `docs/BRANCH-PROTECTION.md`'s `e2e` row is available but not yet a required
  status check — same maintainer action as the other rows in that table.
