# Boards

A **board** is one level's puzzle: a set of slots, each holding one word, and a
**big word** that uses every real letter on the board. WoS+ keeps an archive of
boards it has seen so that the next time the same board comes up it can tell
players exactly which words were missed.

A board is filed under its big word. Big words are made of letters only, and
are between 4 and 20 letters long.

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

- **Given** a lookup for a board named with 21 or more letters
- **When** WoS+ tries to find it
- **Then** the lookup is rejected as an invalid board name length, and the
  archive is never consulted

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
  the shared word list

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

- **Given** a level ended with every slot filled by a player
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

---

## Channel and language on a captured board

The Twitch channel and the word language are informational: they are recorded
when they make sense and quietly dropped when they do not. Neither may ever stop
a good board from being saved.

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
- **Then** the board is saved with English as its language, rather than being
  rejected

---

## Repairing a board that was stored with repeated words

Boards captured before the repeated-word guard existed are still in the archive,
and they mislead every future level that reads them. When WoS+ later sees a
clean capture of the same board, it repairs the stored copy.

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

- **Given** the stored board `CAUTION` has no repeated words
- **When** a repair is offered for it
- **Then** the repair is refused, the stored board is untouched, and the reason
  says the board has no repeated words

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

## Open questions for the maintainer

The following describe how WoS+ behaves today, but it is not clear from the code
whether each is a decision or an accident.

### Scenario: a board saved directly, without going through a level

- **Given** a board is offered for saving with a name that is not 4–20 letters —
  for example `CAT` or `CAUT10N`
- **When** the save is attempted
- **Then** the name is not checked, and the board is saved under that name

> ❓ **Unconfirmed** — this reflects current behaviour; maintainer to confirm it
> is intended. The name rules described at the top of this file are applied when
> WoS+ *looks up* or *repairs* a board, and by the views before they offer a
> capture, but not by the archive when a board is saved for the first time. That
> asymmetry means a badly named board could reach the archive and then never be
> findable again through the normal lookup rules.

### Scenario: a board saved with malformed slots

- **Given** a board is offered for saving whose slots have no letters, or no
  words
- **When** the save is attempted
- **Then** only the repeated-word rule is applied; the slots' shape is not
  checked, and the board is saved

> ❓ **Unconfirmed** — this reflects current behaviour; maintainer to confirm it
> is intended. A repair of the same board *would* be rejected for the same
> malformed slots, so the two paths disagree about what a valid slot is.

### Scenario: the big word disagrees with the last slot

- **Given** a level is being captured
- **And** the big word WoS+ tracked during the level is not the word in the
  board's last slot
- **When** the board is captured
- **Then** the board is filed under the *last slot's* word instead of the
  tracked big word

> ❓ **Unconfirmed** — this reflects current behaviour; maintainer to confirm it
> is intended. It looks like a correction for levels with several anagram big
> words, but it silently changes the identity of the board being saved, so a
> maintainer should confirm the last slot really is always the big word.

### Scenario: a very large archive

- **Given** the archive holds many thousands of boards
- **When** the whole archive is requested
- **Then** every board is returned at once, with no way to ask for a page at a
  time

> ❓ **Unconfirmed** — this reflects current behaviour; maintainer to confirm it
> is intended. Nothing in WoS+ currently asks for the whole archive, so this may
> simply be an unused capability that has not needed paging yet.
