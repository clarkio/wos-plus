# Agentic AI Testing Standards — Research & Implementation Plan for WoS+

This document captures current (2025–2026) industry research on how to build
confidence in code produced by agentic AI coding tools (Claude Code, Copilot
agents, etc.), and lays out a phased, concrete plan to apply those standards to
this project. Everything here is tailored to the WoS+ stack: **TypeScript +
Astro + Vitest + Cloudflare Pages/Workers + Supabase + pnpm**.

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

### 1.3 The one-sentence version

> Confidence in agentic AI code comes from **independent, machine-checkable
> verification at every layer** — types, lint, unit, integration, E2E, mutation
> score, dependency audit — enforced by CI, runnable by the agent itself, with
> tests authored as specifications *before* implementation rather than as
> after-the-fact rationalizations.

---

## Part 2 — Where WoS+ stands today (audit, July 2026)

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

Each phase is independently shippable, ordered by (confidence gained ÷ effort).
Every phase ends with a CI-enforced, agent-runnable gate.

### Phase 0 — Fix the foundation (hours)

1. **Correct the agent instructions.** Rewrite the Testing section of
   `.github/copilot-instructions.md` to describe the real suite, and add a
   `CLAUDE.md` at repo root with the agent contract:
   - Write or update tests **before** implementation for any behavior change;
     commit failing tests first when practical.
   - Never delete or weaken an existing test/assertion to make a change pass —
     flag it in the PR instead.
   - Never add a dependency without stating why in the PR; exact-pin it.
   - Before declaring done, run the full local gate:
     `pnpm run check && pnpm run lint && pnpm run test:coverage && pnpm run build`.
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

### Phase 3 — Real integration tests for API routes (week 1)

Replace the 28 `it.todo` stubs with real tests. These routes are small, pure
`APIRoute` functions — test them by invoking the exported handlers directly
with a constructed `Request` and a mocked `locals.runtime.env`, asserting on
the `Response` (status, headers, JSON body). No server needed; runs in Vitest.

1. Build one shared harness: `tests/integration/api-harness.ts` that fabricates
   Astro `APIContext` (params, request, locals with fake `SUPABASE_URL`/`KEY`).
2. Mock the network **at the boundary, not the module**: use **MSW (Mock
   Service Worker)** to intercept the Supabase REST calls the
   `@supabase/supabase-js` client makes, so the real client code (query
   building, error mapping) is exercised. Same approach for the
   `clarkio.com/wos-dictionary` fetch in `wos-words.ts`.
3. Cover per route: happy path, validation rejections (bad board id, oversized
   payloads, non-alpha words), Supabase error propagation, CORS headers
   (`cors.ts` is currently at 0%), and correct status codes.
4. Keep deterministic: fake timers where timing matters, zero real network
   (fail the suite on unmatched MSW requests).

**Gate:** integration suite in CI; the `it.todo` count for API routes is 0.

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

### Phase 5 — Mutation testing: verify the tests themselves (week 2–3)

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
2. **PR template** with an AI-disclosure + verification checklist:
   - [ ] Tests written/updated *before or with* the implementation
   - [ ] `pnpm run check && lint && test:coverage && build` pass locally
   - [ ] No existing test weakened or deleted (or explicitly justified)
   - [ ] New dependencies: none / listed with justification
   - [ ] Code authored with AI assistance: yes/no (routes reviewer attention —
     review AI code as untrusted-contributor code, focusing on edge cases,
     error handling, and boundaries)
3. **Keep instruction files load-bearing**: `CLAUDE.md` /
   `copilot-instructions.md` are updated in the same PR as any change to
   scripts, gates, or conventions — stale agent instructions are a defect
   class of their own (see the current "no test suite exists" line).
4. **Close the loop in production**: tag Sentry releases per deploy so
   regressions are attributable to specific merges; a spike after an
   agent-authored merge feeds back into which gate should have caught it.

---

## Part 4 — Target end state

```
            Layer                Tool                     CI gate
  ┌───────────────────────┐
  │  E2E (thin)           │  Playwright + wrangler     required job
  ├───────────────────────┤
  │  Integration (fat)    │  Vitest + MSW harness      required job
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
change on `main` unless independent specification-style tests exist for it,
every static/dynamic gate passes, the tests themselves are proven meaningful
by mutation score, and nothing new entered the supply chain unreviewed.

---

## Sources

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
