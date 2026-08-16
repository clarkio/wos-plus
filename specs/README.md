# WoS+ behavioural specs

These files describe **what WoS+ does**, in the language of the game — levels,
slots, letters, guesses, words, boards, clears, channels, streamers, players.
They are deliberately free of code: no function names, no file names, no
technical protocol detail. If you play or stream Words on Stream, you should be
able to read any scenario here and tell us whether it is right or wrong.

That readability is the whole point. These specs are the **independent
contract** that the automated tests are checked against. Tests written by an AI
agent tend to describe whatever the code happens to do; a spec written in game
terms and approved by a human describes what the code *should* do. When the two
disagree, the spec wins or the spec gets changed — deliberately, by a person.

## Who owns these files

The **human maintainer** owns them. Agents may draft scenarios and propose
changes, but a spec change is only real once a maintainer has approved it.

## The rule

> **A behaviour change starts with a spec diff that a human approves, before any
> implementation exists.**

In order:

1. Propose the change here, as a scenario diff in `specs/`.
2. A maintainer approves (or rewrites) it.
3. The acceptance tests are updated to encode the approved scenarios.
4. Only then is the behaviour implemented, until the tests pass.

Bug fixes and refactors that do not change observable behaviour do not need a
spec diff — but if the fix changes what a player or streamer *sees*, it does.

## How to read a scenario

Every scenario is written as **Given / When / Then**:

- **Given** — the situation before anything happens.
- **When** — the single thing that happens.
- **Then** — what is observably true afterwards.

Nothing in a *Then* should require knowing how the code is built. "The board is
rejected and nothing is saved" is a good outcome. "The handler returns 400" is
not — that is the same statement written for a programmer, and a non-programmer
cannot check it.

## Marking uncertainty

Some behaviour in WoS+ was discovered by reading the code rather than by being
designed. Where it is unclear whether something is deliberate or accidental, the
scenario is written as it currently behaves and marked:

> ❓ **Unconfirmed** — this reflects current behaviour; maintainer to confirm it
> is intended.

An unconfirmed scenario is **not yet part of the contract**. It is a question
addressed to the maintainer. Do not treat it as approved, and do not remove the
marker without a maintainer's answer. A spec that quietly presents a bug as
intended behaviour is worse than one full of open questions.

Once a maintainer answers, the scenario is rewritten to say what *should*
happen, and takes one of two other markers:

> ⚠️ **Approved, not yet implemented** — the maintainer has decided; WoS+ does
> not do this yet. Always names the issue tracking the change.

> ✅ **Confirmed (maintainer)** — the current behaviour was deliberate, and the
> reasoning is recorded so it is not re-litigated later.

The distinction matters when reading a test that fails. A ⚠️ scenario is a
known gap with a ticket; the acceptance test beside it still pins **current**
behaviour, so that implementing the change forces the test to be updated
deliberately rather than the spec quietly drifting from the code.

## Vocabulary

These words mean the same thing everywhere in this directory.

| Term | Meaning |
| --- | --- |
| **the game** | Words on Stream itself, running on the streamer's channel |
| **WoS+** | this tool — the player view and the streamer (OBS) view |
| **level** | one round of the game |
| **letters** | the tiles available on the board for the current level |
| **hidden letter** | a tile the game keeps masked (shown as `?`) until revealed |
| **fake letter** | a decoy tile shown on the board that is not really in play |
| **slot** | one place on the board that holds exactly one word |
| **big word** | the longest word on the board — it uses every real letter, and it doubles as the board's identifier |
| **guess** | a word a player types in Twitch chat and the game accepts |
| **clear** | a level where every slot on the board was filled |
| **stars** | the game's score for a finished level; also how many levels it advances |
| **the board archive** | WoS+'s store of boards it has captured, keyed by big word |
| **the shared word list** | the pooled dictionary of words WoS+ knows about |
| **the channel records** | the stored all-time and daily achievements for a channel |
| **the chatbot** | the companion bot that writes daily achievements. Only some channels have it — see below |

### Which channels have the chatbot

Whether a channel has the chatbot is **granted, not detected**. Today the
maintainer turns it on for a channel by hand; in future it is intended to become
a paid feature that a streamer opts into.

Either way it is a deliberate, long-lived property of the channel. It does not
come and go by itself, and nothing that happens during a stream changes it.
That matters for reading any scenario about the daily badges: those badges
follow a **grant**, not a live capability check.

## The specs

| File | Covers |
| --- | --- |
| [boards.md](boards.md) | capturing, looking up, repairing and rejecting boards |
| [words.md](words.md) | the shared word list, and working out which words were missed |
| [channel-stats.md](channel-stats.md) | personal bests, daily bests and daily clears for a channel |
| [game-flow.md](game-flow.md) | connecting, and what a live level looks like from level start to level end |

---

## Decisions from the #160 review

The maintainer worked through this index in review of PR #160 and answered
**every open question**. Recorded here so the reasoning stays findable.

There is no § Open questions section below any more, and that is the point: the
❓ marker exists to make unanswered questions impossible to overlook, so an
empty list is the marker having done its job. New ones will appear here as new
spec work turns them up.

**Approved — WoS+ does not do these yet.** Each is a ⚠️ scenario in the spec,
with an issue tracking the change. The acceptance tests still pin current
behaviour, so implementing one forces its test to be inverted deliberately.

| Was | Decision | Issue |
| --- | --- | --- |
| B1, B2 | The board **save** path must apply the same name, slot and completeness guards as lookup and repair. Today it applies only the repeated-word rule. | [#162](https://github.com/clarkio/wos-plus/issues/162) |
| ~~B3~~ | ~~A board is filed under the **longest** word on it, alphabetically last among ties — not the last slot's word.~~ **Fixed** — `determineBoardId` in `wos-words.ts`, used by `GameSpectator` on both save and lookup. Per [#165](https://github.com/clarkio/wos-plus/issues/165). |
| ~~G2~~ | ~~An unrecoverable masked guess **counts as a clear**, but **blocks the board save**. Two outcomes, deliberately decoupled.~~ **Fixed** — `updateGameState` in `wos-plus-main.ts` records the slot masked (filled, word unknown) instead of dropping it; `saveBoard`'s existing `?`-bearing-slot guard keeps it out of the boards table. Per [#167](https://github.com/clarkio/wos-plus/issues/167). |

**Confirmed — current behaviour is intended.** No work; the reasoning is
recorded in the spec so these are not raised again.

| Was | Decision |
| --- | --- |
| ~~W1~~ | ~~The client-side word-adding path is **retired**. New words are derived from boards, in the database layer, as part of the board save flow. Reading the list is untouched.~~ **Fixed** — `updateWordsDb` in `wos-words.ts` and the commented-out `POST` handler in `src/pages/api/words.ts` are both deleted. Per [#171](https://github.com/clarkio/wos-plus/issues/171). |
| B4 | No paging is fine at ~1,600 boards. Revisit with the stored slot shape if the game ever ships thousands. |
| G4 | A guess for a slot the board lacks **should never happen** — it means WoS+ took up the wrong board data earlier. The display disagreement is a symptom, and tidying it would hide the signal. |
| G5 | The all-time best waits for the chatbot **during play**; the chatbot is the source of truth there. This does not conflict with C3, which is about connect time. |
| G1 | Masking begins at **level 19 and above**. This is the *game's* threshold; WoS+ enforces none, branching only on `?` in the word — so if Words on Stream moves it, WoS+ keeps working and only the spec line changes. |
| W2 | Excluding a never-revealed hidden letter from missed-word suggestions is correct. **Hidden letters are always eventually revealed** by a specific game event, so a still-masked tile at that point is not the normal end state. |
| W3 | Missed words stay matched to the archived board **by slot position**. The repair path is what handles a stored board that disagrees with the game, rather than working around it at read time. |
| ~~C2~~ | ~~The daily badges follow the chatbot **grant**. A failed read must not hide them — it has discovered nothing, not that the channel lost the chatbot.~~ **Fixed** — `GameSpectator.refreshChannelStats()` now only ever turns `chatbotEnabled` on, mirroring the three numbers; the route's own per-request fail-closed answer is unchanged and still correct. Per [#170](https://github.com/clarkio/wos-plus/issues/170). |
| ~~C3~~ | ~~The record level the game reports **on connect** wins over the stored value, and the stored record is updated.~~ **Fixed, scope narrowed** — display-only in `GameSpectator`'s Game Connected handler; WoS+ never writes the record back itself. The chatbot already keeps the stored value in sync for channels that have it, and nothing has ever written it for channels that don't, so there was no write-back left to build — a client-writable stats endpoint would also have been an unauthenticated write path. Per [#166](https://github.com/clarkio/wos-plus/issues/166). |
| ~~C1~~ | ~~A leading `#` is **always** stripped, on the stats path as well as the board path.~~ **Fixed** — the route strips a leading `#` before validating, matching `normalizeTwitchChannel` on the board path. Per [#164](https://github.com/clarkio/wos-plus/issues/164). |
| ~~G3~~ | ~~The 12-letter chat filter is correct and stays; the **board name rule comes down** from 20 to 12 to match it. Longest word in the shared list is 8, so 12 is the cushion.~~ **Fixed** — `validateBoardId` in `[id].ts` and both length checks in `db-service.ts` (save and fetch) now enforce 4–12. Per [#168](https://github.com/clarkio/wos-plus/issues/168). |
| ~~*new*~~ | ~~A board is saved only with a **supplied, supported** word language — no more substituting English.~~ **Fixed** — both `POST /api/boards` and the client's `saveBoard` now reject a fresh save whose language is missing or unrecognised, before anything reaches the archive; a self-healing repair still falls back to the pre-existing default, since a repair carrying no language is meant to leave the stored value alone. Per [#161](https://github.com/clarkio/wos-plus/issues/161). |
| ~~*new*~~ | ~~A board's words must all be spellable from its big word's letters; one that is not makes the board **broken and repairable**.~~ **Fixed** — `PUT /api/boards/[id]` now treats a stored board as broken when a slot's word can't be spelled from the board id's letters, not just when a word is repeated; the "sound stored board" guard widened to match. `hasInvalidWords` in `src/lib/board-utils.ts` reuses `canFormWord` from `wos-words.ts`. Per [#163](https://github.com/clarkio/wos-plus/issues/163). |
| ~~G6~~ | ~~On reconnect, rebuild the found-words list from the re-reported slots only on a level with no masked guesses. On a masked level the gap stays — a masked guess cannot be recovered after the fact.~~ **Fixed** — the WOS socket's `reconnect` event (which only fires after a lost connection recovers, never on the initial connect) now marks the next "Game Connected" event as a genuine reconnect rather than a first-time join to a level already in progress; only that case rebuilds `currentLevelCorrectWords` from the re-reported slots, and only when none of them is masked. Per [#169](https://github.com/clarkio/wos-plus/issues/169). |

Two answers cross-check each other and are worth reading together: **C3** (the
game wins on connect) and **G5** (the chatbot wins during play). The maintainer
has **confirmed** the joining reading — the distinction is *when*, not *what*.

One decision was reached by correcting an agent's inference, and is worth
knowing about before touching the length rules. **G3 was first written the wrong
way round**: it proposed raising the 12-letter chat filter to match the
20-letter board rule. The maintainer reversed it — the longest word in the
shared list is 8, 12 is a deliberate cushion, and the *board* rule comes down.
The migration risk that carried (stranding an already-stored board with a 13–20
letter name) was checked against the archive and cleared: no board id exceeds
12 letters.

---

## Open questions

**None right now.** Every ❓ **Unconfirmed** scenario raised while writing these
specs was answered by the maintainer in the review of PR #160, and each answer is
recorded in the tables above and in the scenario it belongs to.

This section stays because it is the mechanism, not a leftover. When new spec
work turns up behaviour that cannot be told apart from an accident, it is written
as it currently behaves, marked ❓, and listed here — pinned by an acceptance
test asserting *current behaviour under protest* where the behaviour is
reachable, or an `it.todo` naming the question where it is not.

**Nothing here may be resolved by an agent.** Answering one means editing the
spec scenario it points at — and, where a test pins the behaviour, editing that
test in the same change.

### The last one to close: the shape of an unguessed slot

Worth recording because of *how* it was settled. It never appeared in this index
while it was open — it lived in `tests/fixtures/wos-events/README.md` as an
`INFERRED` marker rather than as a spec scenario, which is exactly how a real
question stays invisible to a list that is supposed to catch them.

The maintainer supplied a real level-start payload. WoS sends a `'.'` placeholder
per letter for an unguessed slot:

```json
{ "letters": [".", ".", ".", "."], "user": null, "hitMax": false }
```

so `slot.letters.length` **is** the slot's word length, and `logMissingWords` and
`logEmptySlots` reading it were correct all along. **The fixtures were wrong**,
using `letters: []` — a state the wire never produces — and the "0 letter words"
defect they appeared to expose never existed. The fixtures now match.

An agent note recorded here on purpose: the case for calling this a defect rested
on the claim that the payload "also carries `slot.length`". **It does not.** The
wire has no `word`, `index` or `length` on a slot at all — WoS+ adds those itself
when a guess fills one. The argument for changing the code was built on a field
that was never there, and the only thing that stopped it was that the question
was left open instead of inferred.

### Gaps recorded, not fixed

Not spec scenarios — defects found while writing the acceptance stream, pinned
as canaries so that fixing one forces its note to be resolved rather than left
stale. **All three now have a maintainer decision and a tracking issue.** Each
canary asserts today's behaviour, so landing a fix turns it red and forces the
assertion to be inverted deliberately.

| # | Gap | Pinned by |
| --- | --- | --- |
| ~~X1~~ | ~~All three Supabase-backed routes advertise `OPTIONS` in `Access-Control-Allow-Methods` while exporting **no `OPTIONS` handler**, so a real CORS preflight falls through to a 404. Reachable in practice for `PUT /api/boards/[id]`, which does preflight from a browser.~~ **Fixed** — all three routes (`/api/boards`, `/api/boards/[id]`, `/api/channel-stats/[channel]`) export an `OPTIONS` handler answering a 204, per [#172](https://github.com/clarkio/wos-plus/issues/172). Their formerly static wildcard headers were subsequently unified with `/api/words` behind the configured allow-list in `src/lib/cors.ts`, per [#130](https://github.com/clarkio/wos-plus/issues/130). | "exports the OPTIONS handler its Access-Control-Allow-Methods promises (fixed #172)" in `boards.acceptance.test.ts` (×2) and `channel-stats.acceptance.test.ts` |
| ~~X2~~ | ~~`/api/channel-stats/[channel]` never inspects the all-time or daily read errors, so an unreachable archive answers 200 with three zeros — indistinguishable from a channel that has never played, and worse on screen than an error, because a "successful" zero is news.~~ **Fixed** — the route now inspects every read error and answers 500 rather than fabricate a zero, per [#173](https://github.com/clarkio/wos-plus/issues/173). Same class as C2/[#170](https://github.com/clarkio/wos-plus/issues/170), which remains open. | `channel-stats.acceptance.test.ts` — "reports a failure rather than fabricating zeros when every lookup errors" and the two single-lookup-failure variants beside it |
| X3 | `POST /api/boards` **does not enforce slot completeness** — a slot with an empty word is stored. What keeps incomplete boards out today is the capture side in `wos-plus-main.ts`, which only offers a board once every slot is solved. **Answered in the #160 review** and now tracked by [#162](https://github.com/clarkio/wos-plus/issues/162) along with B1 and B2. | `boards.acceptance.test.ts` — `it.todo` under § "a capture where a word was never fully worked out" |

Two further `it.todo`s are **neither open questions nor gaps** — they are
coverage the acceptance stream cannot reach, recorded so they are not mistaken
for either:

- **Connecting, the join-retry backoff, and switching channels mid-stream**
  (`game-flow.acceptance.test.ts` § Connecting) need a socket.io / tmi fake the
  harness does not have. Mocking those modules is exactly what this stream
  exists to avoid, so they stay with the unit tests until a fake transport
  lands.
- **Sorting a missed word after an identical found word**
  (`game-flow.acceptance.test.ts` § Ending a level (missed words)) is not
  reachable from the event stream: the missed-word calculation excludes every
  word already found, so only a duplicate could show it — and duplicates are
  themselves the bug.
