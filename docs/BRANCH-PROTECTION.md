# Branch protection and maintainer-only settings

The gates in `AGENTIC-TESTING-PLAN.md` are only real if `main` requires them.
Branch protection is a repository setting and **cannot be configured from a
pull request** — a maintainer with admin rights has to enable it in
**Settings → Branches → Branch protection rules**.

> ✅ **Enabled on `main`** (maintainer, during the #160 review). Before this,
> every check in the repo was advisory: an agent or a human could merge straight
> past a red build. That is no longer true, which is what turns the rest of this
> document from a wish-list into enforcement.
>
> This is the single highest-leverage setting in the repository. If it is ever
> turned off, everything below stops being a gate and becomes a suggestion —
> silently, with no failing build to say so.

---

## Rule for `main`

**Require a pull request before merging.** No direct pushes, including from
maintainers. This is what makes the checklist in
`.github/pull_request_template.md` load-bearing.

**Require status checks to pass**, and **require branches to be up to date
before merging** — otherwise a PR that was green against a stale base can merge
and break `main`.

### Checks to require

Check names come from the job names in `.github/workflows/`. Only the first one
exists today; tick the others as their phases land.

| Check | Workflow | Job | Status |
| --- | --- | --- | --- |
| `build` | `tests.yml` | `build` | **available now** — runs install → check → lint → acceptance → test+coverage → build |
| `analyze` | `codeql.yml` | `analyze` | **available now**, landed with #153 — CodeQL, `javascript-typescript`, on PRs/push to `main`/weekly schedule |
| `dependency-review` | `dependency-review.yml` | `dependency-review` | **available now**, landed with #153 — fails on high-severity advisories in a PR's dependency diff |
| `e2e` | e2e workflow | — | pending #152 |
| acceptance stream | `tests.yml` | `build`, step "Run acceptance tests" | **landed with #151** as a separate *step*, not a separate job — see below |

`security.yml`'s two jobs (`gitleaks`, `pnpm-audit`), also landed with #153, are
**not** on this required-checks table on purpose — see the next section.

`mutation.yml`'s two jobs (`incremental` on PRs, `full` on a weekly schedule),
landed with #154, are **also not** required checks, for the same reason as the
`build` job's coarseness point above: a mutation run is much slower than the
rest of the gate and exists to surface surviving mutants for a human or agent
to act on (`CLAUDE.md` § 8), not to block merges yet.

> The single `build` job currently bundles type-check, lint, tests and build.
> That is fine for enforcement (any failure fails the job) but coarse in the
> UI. Splitting it into named jobs is worthwhile once there are more of them.

### Why the acceptance stream is a step, not a job

The two test streams are independently visible as two lines in the `build` job's
log — a red "Run acceptance tests" means the behavioural contract in `specs/`
broke, which is a different failure from a unit test breaking.

It stays a *step* deliberately. Required checks are matched by **job** name, and
this table is the source of truth for what a maintainer ticks in the branch
protection UI. A new job would not be required until someone came back here and
added it, so it would look like a gate while enforcing nothing — the same class
of silent failure as the missing `pull_request` filter described below.
Promoting it to its own job is fine, but the job name must land in this table in
the same change.

### The `pull_request` trigger has no branch filter

`tests.yml` triggers on `pull_request` with **no `branches:` filter**, on
purpose. It previously filtered on `main`, which meant a *stacked* PR — one
targeting another feature branch — ran no tests at all and read as green,
because only third-party checks reported. That happened on PR #159. The `push`
trigger stays scoped to `main`. Do not re-add the filter.

### Also worth enabling

- **Dismiss stale approvals when new commits are pushed.** An approval given
  before an agent pushed three more commits is not an approval of what merges.
- **Require conversation resolution before merging.**
- **Do not allow force pushes** to `main`.

---

## GitHub-native security settings

**This section requires maintainer/repo-admin action.** None of it can be
turned on from a pull request.

In **Settings → Code security**:

- **Secret scanning** — on.
- **Push protection** — on. This blocks a credential at push time rather than
  reporting it after it is already in the history. The live risk in this repo
  is the Supabase keys.
- **Dependabot alerts** — on.

`gitleaks` in CI (`security.yml`, landed with #153) is defence in depth, not a
replacement: it runs after the push has already happened, and it is
deliberately **not** a required check (see the table above) — it exists to
catch what push protection missed, not to gate merges on its own. Its
allowlist (`.gitleaks.toml`) is scoped to two things: the fake Supabase
credentials the acceptance-test harness uses, and Twitch's own public web
`Client-Id` (`src/scripts/twitch-channel.ts`) — a widely-published,
intentionally non-secret identifier, not a leaked credential.

`pnpm audit --prod` also runs in `security.yml` (job `pnpm-audit`), currently
**non-blocking** (`continue-on-error: true`). As of #153 it reports 7 high /
7 moderate / 0 critical advisories, all transitive (astro/cloudflare/sentry
toolchains, socket.io-client) with no patched version yet available within
this repo's pinned major versions. Revisit periodically — this file makes no
claim about *when* it becomes blocking, since that depends on upstream fixes
landing, not on this PR.

---

## Dependency policy for AI-authored PRs

Roughly 20% of AI-generated code samples reference packages that do not exist,
and attackers register those hallucinated names ("slopsquatting"). This repo's
existing conventions — exact-pinned versions and `--frozen-lockfile` installs —
already close most of the gap. The remaining human step:

> **Any new dependency in an AI-authored PR requires a human to verify the
> package is the real, established artifact** — correct name, expected author,
> plausible download history and repository — before approving.

`actions/dependency-review-action` (`dependency-review.yml`, landed with #153)
automates the known-vulnerability half of this. It cannot tell you that a
plausible-looking package name is the one you actually meant.

---

## Sentry release tagging (not yet implemented)

Closing the production feedback loop means being able to attribute a
regression to the merge that caused it. Today `sentry.client.config.js` and
`sentry.server.config.js` call `Sentry.init()` with a DSN and no `release`, so
every event lands in one undifferentiated bucket.

What is needed:

1. Pass `release` to both `Sentry.init()` calls, reading a build-time value.
2. Source that value from the commit SHA. On Cloudflare Pages that is
   `CF_PAGES_COMMIT_SHA`, exposed to the build; in Astro it has to be surfaced
   through `import.meta.env` (a `PUBLIC_`-prefixed variable for the client
   config, since the client bundle cannot read arbitrary build env).
3. Optionally add `environment` so preview deploys are separable from
   production.

This is deliberately left as a documented change rather than a blind
implementation — it needs verification against an actual Cloudflare Pages build,
which cannot be done from a sandbox. Confirm the variable is populated in the
build environment before relying on it.
