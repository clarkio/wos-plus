# Branch protection and maintainer-only settings

The gates in `AGENTIC-TESTING-PLAN.md` are only real if `main` requires them.
Branch protection is a repository setting and **cannot be configured from a
pull request** — a maintainer with admin rights has to enable it in
**Settings → Branches → Branch protection rules**.

Until this is done, every check in this repo is advisory: an agent (or a human)
can merge straight past a red build.

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
| `build` | `tests.yml` | `build` | **available now** — runs install → check → lint → test+coverage → build |
| `analyze` | `codeql.yml` | — | pending #153 |
| `dependency-review` | `dependency-review.yml` | — | pending #153 |
| `e2e` | e2e workflow | — | pending #152 |
| acceptance stream | `tests.yml` (separate step today) | — | pending #151 — promote to its own job so the two test streams are independently visible in the required-checks list |

> The single `build` job currently bundles type-check, lint, tests and build.
> That is fine for enforcement (any failure fails the job) but coarse in the
> UI. Splitting it into named jobs is worthwhile once there are more of them.

### Also worth enabling

- **Dismiss stale approvals when new commits are pushed.** An approval given
  before an agent pushed three more commits is not an approval of what merges.
- **Require conversation resolution before merging.**
- **Do not allow force pushes** to `main`.

---

## GitHub-native security settings

In **Settings → Code security**:

- **Secret scanning** — on.
- **Push protection** — on. This blocks a credential at push time rather than
  reporting it after it is already in the history. The live risk in this repo
  is the Supabase keys.
- **Dependabot alerts** — on.

`gitleaks` in CI (pending #153) is defence in depth, not a replacement: it runs
after the push has already happened.

---

## Dependency policy for AI-authored PRs

Roughly 20% of AI-generated code samples reference packages that do not exist,
and attackers register those hallucinated names ("slopsquatting"). This repo's
existing conventions — exact-pinned versions and `--frozen-lockfile` installs —
already close most of the gap. The remaining human step:

> **Any new dependency in an AI-authored PR requires a human to verify the
> package is the real, established artifact** — correct name, expected author,
> plausible download history and repository — before approving.

`actions/dependency-review-action` (pending #153) automates the
known-vulnerability half of this. It cannot tell you that a plausible-looking
package name is the one you actually meant.

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
