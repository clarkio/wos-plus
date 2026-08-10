# Boards

A **board** is one level's puzzle: a set of slots, each holding one word, and a
**big word** that uses every real letter on the board. WoS+ keeps an archive of
boards it has seen so that the next time the same board comes up it can tell
players exactly which words were missed.

A board is filed under its big word. Big words are made of letters only, and
are between 4 and 12 letters long.

Twelve is a deliberate cushion, not a measurement: the longest word in the
shared word list is 8 letters, and 12 leaves room for Words on Stream to add
longer words without the rule needing to move. The same 12 applies to the chat
messages kept for matching a masked guess (see [game-flow.md](game-flow.md)),
so the two limits agree.

Related: [game-flow.md](game-flow.md) covers *when* during a level a board is
captured; [words.md](words.md) covers how missed words are worked out.

---

## Naming a board

The big word is displayed on screen spaced out (`C A U T I O N`), and players
and streamers may type it in any case. WoS+ treats all of those as the same
board.

### Scenario: the big word is written the way it appears on screen

- **Given** a board is filed under the big word `CAUTION`
- **When** WoS+ looks the board up as `C A U T I O N`
- **Then** the same board is found

### Scenario: the big word is written in lower case

- **Given** a board is filed under the big word `CAUTION`
- **When** WoS+ looks the board up as `caution`
- **Then** the same board is found

### Scenario: a board name containing anything other than letters

- **Given** a lookup for a board named `CAUT10N`
- **When** WoS+ tries to find it
- **Then** the lookup is rejected as an invalid board name, and the archive is
  never consulted

### Scenario: a board name that is too short to be a big word

- **Given** a lookup for a board named `CAT`
- **When** WoS+ tries to find it
- **Then** the lookup is rejected as an invalid board name length, and the
  archive is never consulted

### Scenario: a board name that is too long to be a big word

- **Given** a lookup for a board named with 13 or more letters
- **When** WoS+ tries to find it
- **Then** the lookup is rejected as an invalid board name length, and the
  archive is never consulted

> ✅ **Confirmed (maintainer)** — implemented in
> [#168](https://github.com/clarkio/wos-plus/issues/168). Board names now run
> 4–12 letters on both the lookup (`validateBoardId` in `[id].ts`) and the
> `db-service.ts` save/fetch paths.
>
> The migration risk this carried was **checked and cleared** before landing:
> lowering the limit would have stranded any already-stored board with a
> 13–20 letter name, and the maintainer confirmed no board id in the archive
> exceeds 12 letters. No migration was needed.

### Scenario: no board name at all

- **Given** a lookup with no board name given
- **When** WoS+ tries to find it
- **Then** the lookup is rejected because a board name is required

---

## Looking up a board

### Scenario: the board has been seen before

- **Given** the board `CAUTION` is in the archive with all of its slots
- **When** WoS+ looks up `CAUTION`
- **Then** the board comes back with every slot and its word

### Scenario: the board has never been captured

- **Given** the archive holds no board named `CAUTION`
- **When** WoS+ looks up `CAUTION`
- **Then** WoS+ is told the board is not found — this is a normal answer, not a
  failure, and the level simply falls back to working the missed words out from
  the shared word list, based on all of the known valid letters for that level
  and board

### Scenario: the archive cannot be reached during a lookup

- **Given** the board archive is unavailable
- **When** WoS+ looks up `CAUTION`
- **Then** WoS+ is told the lookup failed, and treats the board as unknown for
  the rest of the level

---

## Capturing a board

A board is only ever captured from a level WoS+ believes is complete — see
[game-flow.md](game-flow.md).

### Scenario: a completed board is captured

- **Given** a level ended with every slot filled with a word
- **And** the big word is known
- **When** WoS+ captures the board
- **Then** the board is filed under its big word, with every slot's word, and
  with the Twitch channel and the game's word language recorded alongside it

### Scenario: the board was already captured

- **Given** the board `CAUTION` is already in the archive, and its stored copy
  is sound
- **When** WoS+ captures `CAUTION` again
- **Then** nothing is saved, the stored board is left exactly as it was, and
  WoS+ reports that the board has already been saved

### Scenario: a capture where the same word fills two slots

- **Given** a capture of board `CAUTION` in which the word `ACTION` appears in
  two different slots
- **When** WoS+ tries to save it
- **Then** the board is rejected, nothing is saved, and the reason names the
  word or words that were repeated

  Every slot on a board is a different word, so a repeated word means the
  capture went wrong. Saving it would leave a corrupted board in the archive
  that every future level would then read back as truth.

### Scenario: a capture where a word was never fully worked out

- **Given** a capture in which at least one slot still has masked letters or an
  empty word
- **When** WoS+ tries to save it
- **Then** nothing is saved — an incomplete board is worse than no board

> ✅ **Confirmed (maintainer)** — enforced at two layers. The capture side in
> `src/scripts/wos-plus-main.ts` only offers a board once every slot is
> solved; since [#162](https://github.com/clarkio/wos-plus/issues/162), `POST
> /api/boards` also refuses a slot with an empty word directly, so the archive
> no longer relies on caller discipline alone.

---

## Channel and language on a captured board

The Twitch channel is informational: it is recorded when it makes sense and
quietly dropped when it does not, and it may never stop a good board from being
saved.

The word language is **not** informational. A board's words only mean anything
alongside the language they were played in, so the language must be supplied and
must be one Words on Stream actually plays in. A board with no language, or an
unrecognised one, is not saved.

### Scenario: a channel name is tidied before it is recorded

- **Given** a capture from the channel `#ClarkIO`
- **When** the board is saved
- **Then** the board records the channel as `clarkio`

### Scenario: a channel name that is not a real Twitch name

- **Given** a capture whose channel name contains spaces, punctuation, or is
  longer than 50 characters
- **When** the board is saved
- **Then** the board is saved without any channel recorded, rather than being
  rejected

### Scenario: the game's word language is recorded

- **Given** a capture from a game playing in Portuguese
- **When** the board is saved
- **Then** the board records Portuguese as its word language

  Words on Stream plays in English, Portuguese and French.

### Scenario: an unrecognised word language

- **Given** a capture whose word language is not one Words on Stream plays in
- **When** the board is saved
- **Then** the board is rejected and nothing is saved

> ✅ **Confirmed (maintainer)** — implemented in
> [#161](https://github.com/clarkio/wos-plus/issues/161). Both `POST
> /api/boards` and the client's `saveBoard` now reject a capture whose
> language is missing or unrecognised, before anything reaches the archive.
> The English-substitution path is gone.

### Scenario: a capture with no word language at all

- **Given** a capture that carries no word language
- **When** the board is saved
- **Then** the board is rejected and nothing is saved

> ✅ **Confirmed (maintainer)** — implemented in
> [#161](https://github.com/clarkio/wos-plus/issues/161), alongside the
> scenario above.

---

## Repairing a board that was stored badly

Boards captured before the current guards existed are still in the archive, and
they mislead every future level that reads them. When WoS+ later sees a clean
capture of the same board, it repairs the stored copy.

A stored board is **broken** — and so eligible for repair — if either of these is
true of it:

- the same word fills two or more slots, or
- any slot's word uses a letter that is not on the board.

**Valid letters for a board are exactly the letters of its big word.** The big
word uses every real letter on the board, so a word containing a letter that the
big word does not have could not have been played on that board, and its
presence means the stored copy is wrong.

### Scenario: a stored board containing a word with letters that are not on the board

- **Given** the board `CAUTION` is in the archive
- **And** one of its slots holds the word `ACTOR`, which uses an `R` that
  `CAUTION` does not have
- **When** WoS+ examines the stored board
- **Then** the board is treated as broken and needs to be repaired, in the same
  way as a board with a repeated word

  A word that cannot be spelled from the big word's letters was never really on
  this board. Left in the archive it is reported to players as a word they
  missed, sending them to type something the game will refuse.

> ✅ **Confirmed (maintainer)** — implemented in
> [#163](https://github.com/clarkio/wos-plus/issues/163). `PUT
> /api/boards/[id]` now treats a stored board as broken (and eligible for
> repair) when a slot's word cannot be spelled from the board id's letters,
> not just when a word is repeated — `hasInvalidWords` in
> `src/lib/board-utils.ts` reuses `canFormWord`'s letter-frequency check from
> `wos-words.ts` rather than a third re-implementation. The "sound stored
> board" guard below widened accordingly: a board is sound only if it has
> neither repeated words nor invalid words.

### Scenario: a corrupted stored board is replaced by a clean capture

- **Given** the stored board `CAUTION` has the same word in two slots
- **And** WoS+ has just captured `CAUTION` cleanly, with every slot a different
  word
- **When** WoS+ offers the clean capture as a repair
- **Then** the stored board's slots are replaced by the clean ones

### Scenario: a repair also fills in a missing channel and language

- **Given** the stored board `CAUTION` is being repaired
- **And** the clean capture came from a known channel, in a known language
- **When** the repair is applied
- **Then** the channel and language are recorded on the stored board too

### Scenario: a repair carrying no channel or language leaves those alone

- **Given** the stored board `CAUTION` is being repaired
- **And** the repair carries no channel, or a channel name that is not a real
  Twitch name
- **When** the repair is applied
- **Then** the slots are replaced but whatever channel and language were already
  recorded stay as they were

### Scenario: a sound stored board is never overwritten

- **Given** the stored board `CAUTION` has no repeated words, and no words using
  letters that are not on the board
- **When** a repair is offered for it
- **Then** the repair is refused, the stored board is untouched, and the reason
  says the board is already sound

  This is the safety catch on the whole repair path: repair can only ever make a
  broken board good, never make a good board broken.

### Scenario: a repair that itself contains repeated words

- **Given** a repair for `CAUTION` in which the same word appears in two slots
- **When** the repair is offered
- **Then** it is rejected, nothing is changed, and the reason names the repeated
  words

### Scenario: a repair with no slots

- **Given** a repair for `CAUTION` that carries an empty list of slots
- **When** the repair is offered
- **Then** it is rejected and nothing is changed

### Scenario: a repair with a malformed slot

- **Given** a repair for `CAUTION` in which some slot has no letters or no word
- **When** the repair is offered
- **Then** it is rejected and nothing is changed

### Scenario: a repair that cannot be read at all

- **Given** a repair for `CAUTION` whose contents WoS+ cannot make sense of
- **When** the repair is offered
- **Then** it is rejected and nothing is changed

### Scenario: a repair for a board that was never captured

- **Given** the archive holds no board named `CAUTION`
- **When** a repair is offered for `CAUTION`
- **Then** WoS+ is told the board is not found, and no new board is created

  Repair only ever mends an existing board; it never becomes a second way to add
  one.

### Scenario: the archive cannot be reached during a repair

- **Given** the board archive is unavailable
- **When** a repair is offered
- **Then** nothing is changed and WoS+ is told the repair failed

---

## Browsing the archive

### Scenario: listing every captured board

- **Given** the archive holds several boards
- **When** the whole archive is requested
- **Then** every stored board comes back, each with its slots

### Scenario: an empty archive

- **Given** the archive holds no boards at all
- **When** the whole archive is requested
- **Then** an empty list comes back — this is a normal answer, not a failure

### Scenario: the archive cannot be reached while listing

- **Given** the board archive is unavailable
- **When** the whole archive is requested
- **Then** WoS+ is told the listing failed, and no boards come back

---

## Saving a board directly

A board can be offered to the archive without going through a level. That path
must hold to the same rules as every other.

### Scenario: a board offered for saving under a name that is not a big word

- **Given** a board is offered for saving with a name that is not 4–12 letters —
  for example `CAT` or `CAUT10N`
- **When** the save is attempted
- **Then** the board is rejected as an invalid board name, and nothing is saved

> ✅ **Confirmed (maintainer)** — implemented in
> [#162](https://github.com/clarkio/wos-plus/issues/162). `POST /api/boards`
> now validates the board id with the same `validateBoardName` rule that
> `[id].ts` already applied on lookup and repair (`src/lib/board-utils.ts`),
> so a board can no longer be filed under a name the lookup path will then
> always reject.

### Scenario: a board offered for saving with malformed slots

- **Given** a board is offered for saving whose slots have no letters, or no
  words
- **When** the save is attempted
- **Then** the board is rejected, and nothing is saved

> ✅ **Confirmed (maintainer)** — implemented in
> [#162](https://github.com/clarkio/wos-plus/issues/162). `POST /api/boards`
> now rejects a missing or malformed `slots` array with the same
> `isWellFormedSlot` check `PUT /api/boards/[id]` already applied on repair.
> This also closes the completeness gap noted under "Capturing a board" above:
> an unsolved slot (empty word) is exactly the shape this guard rejects.

### Scenario: which word a board is filed under

- **Given** a level is being captured
- **When** the board is captured
- **Then** it is filed under the longest word on the board, and where several
  words tie for longest, the alphabetically last of them

  Anagram big words (`LISTEN` / `SILENT`) tie on length, so without a
  deterministic tie-break the same board would be filed under a different name
  on different nights, splitting one board into two half-true archive entries.

> ✅ **Confirmed (maintainer)** — implemented in
> [#165](https://github.com/clarkio/wos-plus/issues/165). `determineBoardId` in
> `src/scripts/wos-words.ts` picks the alphabetically last anagram among the
> tracked big word, the level's filled slot words, and the loaded dictionary,
> instead of trusting whichever word happens to sit in the board's last slot.
> `GameSpectator` uses it on both save (`handleLevelResults`) and lookup
> (`logMissingWords`, retrying under the guessed big word for boards saved
> before ids were canonicalized). Because a level's tracked big word is always
> derived from a `hitMax` guess (one that uses every letter), every candidate
> this compares is already the same, maximal length — so "longest" is
> structural and the remaining work is exactly the alphabetical tie-break.

---

## Known limitations

Behaviour the maintainer has confirmed is deliberate for now, recorded so it is
not mistaken for an oversight and re-litigated later.

### Scenario: a very large archive

- **Given** the archive holds many thousands of boards
- **When** the whole archive is requested
- **Then** every board is returned at once, with no way to ask for a page at a
  time

> ✅ **Confirmed (maintainer)** — intended for now. Playing the game has turned
> up roughly 1,600 boards in total, and that is not expected to grow quickly.
> Paging will be needed if Words on Stream ever ships thousands of boards.
>
> Recorded alongside it: a board currently stores the slot data exactly as the
> game reports it, which is more than WoS+ needs — the minimum is each slot's
> index and word. Storing the game's shape verbatim keeps the capture path
> simple, and is a deliberate trade to revisit at the same time as paging.
