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

The maintainer worked through this index in review of PR #160 and answered ten
of the thirteen questions. Recorded here so the reasoning stays findable.

**Approved — WoS+ does not do these yet.** Each is a ⚠️ scenario in the spec,
with an issue tracking the change. The acceptance tests still pin current
behaviour, so implementing one forces its test to be inverted deliberately.

| Was | Decision | Issue |
| --- | --- | --- |
| B1, B2 | The board **save** path must apply the same name, slot and completeness guards as lookup and repair. Today it applies only the repeated-word rule. | [#162](https://github.com/clarkio/wos-plus/issues/162) |
| B3 | A board is filed under the **longest** word on it, alphabetically last among ties — not the last slot's word. | [#165](https://github.com/clarkio/wos-plus/issues/165) |
| C1 | A leading `#` is **always** stripped, on the stats path as well as the board path. | [#164](https://github.com/clarkio/wos-plus/issues/164) |
| C3 | The record level the game reports **on connect** wins over the stored value, and the stored record is updated. All-time best only. | [#166](https://github.com/clarkio/wos-plus/issues/166) |
| G2 | An unrecoverable masked guess **counts as a clear**, but **blocks the board save**. Two outcomes, deliberately decoupled. | [#167](https://github.com/clarkio/wos-plus/issues/167) |
| G3 | The 12-letter chat filter is correct and stays; the **board name rule comes down** from 20 to 12 to match it. Longest word in the shared list is 8, so 12 is the cushion. | [#168](https://github.com/clarkio/wos-plus/issues/168) |
| *new* | A board's words must all be spellable from its big word's letters; one that is not makes the board **broken and repairable**. | [#163](https://github.com/clarkio/wos-plus/issues/163) |
| *new* | A board is saved only with a **supplied, supported** word language — no more substituting English. | [#161](https://github.com/clarkio/wos-plus/issues/161) |

**Confirmed — current behaviour is intended.** No work; the reasoning is
recorded in the spec so these are not raised again.

| Was | Decision |
| --- | --- |
| B4 | No paging is fine at ~1,600 boards. Revisit with the stored slot shape if the game ever ships thousands. |
| G4 | A guess for a slot the board lacks **should never happen** — it means WoS+ took up the wrong board data earlier. The display disagreement is a symptom, and tidying it would hide the signal. |
| G5 | The all-time best waits for the chatbot **during play**; the chatbot is the source of truth there. This does not conflict with C3, which is about connect time. |

Two answers cross-check each other and are worth reading together: **C3** (the
game wins on connect) and **G5** (the chatbot wins during play). The joining
inference — that the distinction is *when*, not *what* — is flagged for
confirmation in [#166](https://github.com/clarkio/wos-plus/issues/166).

---

## Open questions

Every ❓ **Unconfirmed** scenario across these specs, in one list, so a
maintainer can work through them without reading four files.

**This is an index, not a decision log.** Nothing here has been decided, and
nothing here may be resolved by an agent. Answering one means editing the spec
scenario it points at — and, where a test pins the behaviour, editing that test
in the same change.

Most are pinned by an acceptance test that asserts **current behaviour under
protest**: the test passes today, and if someone changes the behaviour the test
fails and forces the question to be answered rather than quietly settled.
Where the behaviour is not reachable from the code the acceptance stream can
drive, it is an `it.todo` naming the question instead. Both kinds are marked
below.

### Channel stats — [channel-stats.md § Open questions](channel-stats.md)

| # | Question | Pinned by |
| --- | --- | --- |
| C2 | A brief failure reading the channel records **hides the daily badges**: the three numbers are protected from a failed refresh, but `chatbotEnabled` is not, so badges flicker away on a blip. Still open after the #160 review — the answer there settled *when* the numbers may change, not whether the badges should vanish. **Sharpened by a later answer**: having the chatbot is a *granted* property of the channel (manually today, a paid opt-in later), so it cannot actually change mid-stream — which makes a failed read reporting "no chatbot" a wrong answer rather than a stale one. | route half: `channel-stats.acceptance.test.ts` — "reports the chatbot as disabled on a blip …"; view half: `it.todo` (lives in `wos-plus-main.ts`) |

### Words — [words.md](words.md)

| # | Question | Pinned by |
| --- | --- | --- |
| W1 | **Adding words to the shared list is not wired up at all.** The whole "Adding a newly seen word" section is unconfirmed: `/api/words` exports `GET` and `OPTIONS` only (the `POST` handler is commented out, there is no `PATCH`), and the one client-side add path, `updateWordsDb`, `PATCH`es `clarkio.com/wos-dictionary` and has no callers anywhere in `src/`. Should adding be wired up, or retired? | `words.acceptance.test.ts` — canary "serves reads only — no way to add a word exists on this route today", plus three `it.todo`s naming the sub-questions |
| W2 | A hidden letter **never revealed** is excluded from the missed-word suggestions, while a masked chat guess treats the same tile as standing for any letter. The two paths disagree. | spec only — no acceptance pin |
| W3 | Missed words from an archived board are matched **by slot position**, so a board presented with its slots re-ordered would under-report. It is not known whether slot order is stable. | spec only — no acceptance pin |

### Game flow — [game-flow.md § Masked guesses](game-flow.md) and [§ Open questions](game-flow.md)

| # | Question | Pinned by |
| --- | --- | --- |
| G1 | **Which level the game starts masking guesses at.** The code comments say 19, the architecture notes said 20. Note that **WoS+ itself has no level threshold**: `currentLevel` is only ever assigned, never compared, and the masked path is chosen purely by whether the word arrives with `?` in it. The question is about the *game*, not about WoS+. | `game-flow.acceptance.test.ts` — a masked event at level 3 resolves exactly as one at level 19 would |
| G6 | On **reconnecting** mid-level, the slots come back correct because the game re-reports them, but the **found-words list does not** — guesses made during the outage were never seen, so the list can be missing words the slots beside it show. Should WoS+ rebuild the list from the re-reported slots, or leave the gap? WoS+ does not currently tell a reconnect apart from joining a game in progress. | spec only — no acceptance pin; raised by the maintainer during the #160 review |

### Gaps recorded, not fixed

Not spec scenarios — defects found while writing the acceptance stream, pinned
as canaries so that fixing one forces its note to be resolved rather than left
stale. Each needs a maintainer decision because fixing it is new behaviour.

| # | Gap | Pinned by |
| --- | --- | --- |
| X1 | All three Supabase-backed routes advertise `OPTIONS` in `Access-Control-Allow-Methods` while exporting **no `OPTIONS` handler**, so a real CORS preflight falls through to a 404. Reachable in practice for `PUT /api/boards/[id]`, which does preflight from a browser. | "advertises OPTIONS but exports no handler for it" in `boards.acceptance.test.ts` (×2) and `channel-stats.acceptance.test.ts` |
| X2 | `/api/channel-stats/[channel]` never inspects the all-time or daily read errors, so an **unreachable archive answers 200 with three zeros** — indistinguishable from a channel that has never played, and worse on screen than an error, because a "successful" zero is news. | `channel-stats.acceptance.test.ts` — the canary under § "A failed refresh leaves the numbers alone" |
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
