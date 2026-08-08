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
| API routes | `src/pages/api/**` | Must `export const prerender = false`; env via `locals.runtime.env` |
| Shared helpers | `src/lib/**` | e.g. `cors.ts`, `board-utils.ts`, `launch-menu.ts` |
| Tests | `tests/unit/`, `tests/acceptance/`, `tests/property/` | Vitest 4 + happy-dom; setup in `tests/setup.ts`. Two streams — see §7 |
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

- Test suite: **649 passing** Vitest tests across 19 files, plus **6
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
- Coverage: **90.98% statements / 86.70% branches / 88.06% functions /
  91.68% lines**. It counts **all** files under `src/**/*.ts`, so an untested
  module appears at 0% instead of being invisible.
  - `src/pages/api/**`, `src/lib/cors.ts` and `src/lib/board-utils.ts` are at
    **100%**, covered by the acceptance stream.
  - `src/scripts/wos-widget.ts` is still at **0%** — the one module no test
    imports.
  - **Thresholds are enforced** (`vitest.config.ts` `coverage.thresholds`,
    landed with [#155](https://github.com/clarkio/wos-plus/issues/155)):
    global floor statements 90 / branches 85 / functions 86 / lines 90, plus
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
  `--max-warnings 0`. **63** pre-existing violations across 17 files are
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
