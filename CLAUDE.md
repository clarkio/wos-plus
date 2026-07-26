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
| Tests | `tests/unit/`, `tests/integration/` | Vitest 4 + happy-dom; setup in `tests/setup.ts` |

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
- `pnpm run test:coverage` — full suite, single run, with coverage.
- `pnpm run build` — production build.

Note: `pnpm test` is **watch mode**. Never use it in CI or in an agent loop; use
`pnpm run test:run`.

> `pnpm run lint` runs ESLint at `--max-warnings 0`. Pre-existing findings are
> recorded in `eslint-suppressions.json` as a **ratchet baseline**: a new
> violation is not suppressed and fails the build. Shrink that file; never
> regenerate it wholesale to absorb a new violation.

CI ([.github/workflows/tests.yml](.github/workflows/tests.yml)) runs the same
sequence: install → check → test + coverage → build.

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

- Test suite: **271 passing** Vitest tests + 28 `it.todo` placeholders in
  `tests/integration/api-routes.test.ts`.
- `pnpm run check` is **clean** (0 errors, 0 warnings; some hints remain).
- Coverage counts **all** files under `src/**/*.ts`, so untested modules
  (`wos-worker.ts`, `wos-widget.ts`, parts of `src/pages/api/**`, `cors.ts`)
  appear at 0% instead of being invisible. There are **no coverage thresholds
  yet** — do not let that absence justify lowering coverage.
- Known coverage-tooling gap: the four API routes that `import { env } from
  'cloudflare:workers'` (`api/words.ts`, `api/boards/index.ts`,
  `api/boards/[id].ts`, `api/channel-stats/[channel].ts`) are dropped from the
  coverage report with a "Failed to parse … Excluding it from coverage" warning,
  because that module specifier does not resolve under Vitest. Resolving it
  (alias/stub) is a prerequisite for real API-route coverage.
- ESLint 9 flat config (`eslint.config.js`), type-aware, enforced at
  `--max-warnings 0`. 68 pre-existing violations are suppressed via
  `eslint-suppressions.json` and should be burned down over time; the
  `no-unsafe-*` family is downgraded repo-wide pending real payload types.
  `no-explicit-any`, `no-floating-promises`, and `switch-exhaustiveness-check`
  are hard errors on all new code.
