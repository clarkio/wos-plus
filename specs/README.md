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
