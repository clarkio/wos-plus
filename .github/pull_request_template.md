<!--
Keep this short. A template nobody fills in is worse than none.
Delete any section that genuinely doesn't apply.
-->

## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## Verification

- [ ] Spec in `specs/` added or updated (behavior changes only — see note below)
- [ ] Tests written or updated *before or with* the implementation
- [ ] `pnpm run check && pnpm run lint && pnpm run test:coverage && pnpm run build` pass locally
- [ ] No existing test weakened, skipped, or deleted (if one was, justify it below)
- [ ] New dependencies: **none** / listed below with justification
- [ ] Code authored with AI assistance: **yes** / **no**

<!--
Why the AI-disclosure line exists: it routes reviewer attention, nothing more.
AI-generated code is reviewed like an untrusted contributor's — the defects
cluster in edge cases, error handling, and boundaries rather than in syntax.
Answering "yes" is not a mark against the PR.

The `specs/` checkbox applies once the acceptance-test stream lands (#151).
Until then, tick it N/A.
-->

## Notes for the reviewer

<!--
Anything that needs a human decision. In particular:
- An existing test you believe encodes wrong behavior (leave it failing, say so
  here — do not "fix" the test to match the code).
- A surviving mutant on lines this PR touched.
- A new dependency: what it does, why a hand-rolled alternative is worse, and
  its maintenance status.
- An ESLint suppression you had to add, and why a real fix was out of scope.
-->
