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
| **the chatbot** | the companion bot that writes daily achievements; only some channels have it |

## The specs

| File | Covers |
| --- | --- |
| [boards.md](boards.md) | capturing, looking up, repairing and rejecting boards |
| [words.md](words.md) | the shared word list, and working out which words were missed |
| [channel-stats.md](channel-stats.md) | personal bests, daily bests and daily clears for a channel |
| [game-flow.md](game-flow.md) | connecting, and what a live level looks like from level start to level end |

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

### Boards — [boards.md § Open questions](boards.md)

| # | Question | Pinned by |
| --- | --- | --- |
| B1 | A board can be **saved** under a name the lookup rules will always reject (`CAT`, `CAUT10N`) — the save path applies no name rules, the lookup and repair paths do. The board lands in the archive and is then unreachable. | `boards.acceptance.test.ts` — "Unconfirmed: stores a board named with …" and "… can then never be looked up" |
| B2 | A board can be **saved** with malformed slots (no letters, no word, empty word, `null`) that a **repair** of the same board would reject. The two paths disagree about what a valid slot is. | `boards.acceptance.test.ts` — "Unconfirmed: stores a board containing …" |
| B3 | A capture is filed under the **last slot's** word rather than the big word WoS+ tracked, silently changing the board's identity. | `boards.acceptance.test.ts` — `it.todo` (happens in the capture path in `wos-plus-main.ts`, before the route sees it) |
| B4 | Listing the whole archive has **no paging**, and ignores paging hints. `/api/words` does page, so the machinery exists. | `boards.acceptance.test.ts` — "Unconfirmed: asks for the whole archive in one go" and "offers no way for a caller to ask for a page" |

### Channel stats — [channel-stats.md § Open questions](channel-stats.md)

| # | Question | Pinned by |
| --- | --- | --- |
| C1 | `#clarkio` is **rejected** when stats are read, but **accepted** (with the `#` stripped) when a channel is recorded on a captured board. Two normalisers, two answers. | `channel-stats.acceptance.test.ts` — "rejects a leading hash — unconfirmed, pending maintainer decision" |
| C2 | A brief failure reading the channel records **hides the daily badges**: the three numbers are protected from a failed refresh, but `chatbotEnabled` is not, so badges flicker away on a blip. | route half: `channel-stats.acceptance.test.ts` — "reports the chatbot as disabled on a blip …"; view half: `it.todo` (lives in `wos-plus-main.ts`) |
| C3 | The **record level the game sends on connect is ignored**, although a code comment says the all-time best comes from the game. Either the comment is stale or the number should be used. | `channel-stats.acceptance.test.ts` — `it.todo` |

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
| G2 | A masked guess that **cannot be recovered** from chat leaves the slot counted as never filled: it can stop a level counting as a clear, and its word can be reported as missed even though a player found it. Recording it as filled-with-unknown-word would mean capturing a blank word, which is refused elsewhere. | `game-flow.acceptance.test.ts` — "treats a slot filled by an unrecoverable masked guess as never filled (❓ unconfirmed)" |
| G3 | A masked guess of **13 or more letters can never be recovered**, because the chat filter keeps only 4–12 letter messages. Big words can be longer, and board names allow 20. | `game-flow.acceptance.test.ts` — `it.todo` (the filter lives in `twitch-chat-worker.ts`) |
| G4 | A guess for a **slot the board does not have** is shown in the found-words list but fills no slot, so the list and the board disagree. | `game-flow.acceptance.test.ts` — "shows a guess for a slot the board does not have, but fills no slot" |
| G5 | The all-time best **does not rise to a level just reached** while the chatbot lags behind; WoS+ knows the number but waits for the chatbot. | partially — `game-flow.acceptance.test.ts` "refreshes the channel records after a level, and never lowers a number" pins the never-lowers half |

### Gaps recorded, not fixed

Not spec scenarios — defects found while writing the acceptance stream, pinned
as canaries so that fixing one forces its note to be resolved rather than left
stale. Each needs a maintainer decision because fixing it is new behaviour.

| # | Gap | Pinned by |
| --- | --- | --- |
| X1 | All three Supabase-backed routes advertise `OPTIONS` in `Access-Control-Allow-Methods` while exporting **no `OPTIONS` handler**, so a real CORS preflight falls through to a 404. Reachable in practice for `PUT /api/boards/[id]`, which does preflight from a browser. | "advertises OPTIONS but exports no handler for it" in `boards.acceptance.test.ts` (×2) and `channel-stats.acceptance.test.ts` |
| X2 | `/api/channel-stats/[channel]` never inspects the all-time or daily read errors, so an **unreachable archive answers 200 with three zeros** — indistinguishable from a channel that has never played, and worse on screen than an error, because a "successful" zero is news. | `channel-stats.acceptance.test.ts` — the canary under § "A failed refresh leaves the numbers alone" |
| X3 | `POST /api/boards` **does not enforce slot completeness** — a slot with an empty word is stored. What keeps incomplete boards out today is the capture side in `wos-plus-main.ts`, which only offers a board once every slot is solved. Same root cause as B2. | `boards.acceptance.test.ts` — `it.todo` under § "a capture where a word was never fully worked out" |

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
