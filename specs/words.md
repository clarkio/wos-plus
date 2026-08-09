# Words

WoS+ keeps a **shared word list** — the pool of words it knows Words on Stream
accepts. It uses that list for two things: working out which words a channel
missed at the end of a level, and recognising a real word when it has to
reconstruct a masked guess from Twitch chat.

Words on Stream only ever uses words of 4 letters or more.

Related: [game-flow.md](game-flow.md) covers when missed words are shown;
[boards.md](boards.md) covers the archived boards that missed words are
preferably drawn from.

---

## Loading the shared word list

### Scenario: the word list loads when a view opens

- **Given** a player or streamer opens their WoS+ view
- **When** the view starts up
- **Then** WoS+ loads the whole shared word list, however many words it holds,
  and reports how many words it knows

### Scenario: the word list is very large

- **Given** the shared word list holds far more words than can be sent in one
  go
- **When** WoS+ loads it
- **Then** every word is loaded — the fact that it arrived in several batches is
  invisible to the player

### Scenario: the word list is empty

- **Given** the shared word list holds no words
- **When** WoS+ loads it
- **Then** WoS+ knows no words — this is a normal answer, not a failure

### Scenario: the word list cannot be reached

- **Given** the shared word list is unavailable
- **When** WoS+ tries to load it
- **Then** WoS+ carries on running with no words known: levels are tracked
  normally, guesses are still shown, and the only thing lost is the missed-word
  suggestions at the end of a level

  Losing the word list must never stop a stream. Every part of WoS+ that uses
  the list treats "no words known" as an ordinary state.

### Scenario: extra spacing around a stored word

- **Given** the shared word list holds a word with stray spaces around it
- **When** WoS+ loads the list
- **Then** the word is known without the spaces

---

## Recognising a word

### Scenario: a known word is recognised whatever its case

- **Given** the shared word list holds `caution`
- **When** WoS+ is asked whether `CAUTION` is a word
- **Then** it is recognised

### Scenario: an unknown word is not recognised

- **Given** the shared word list does not hold `zzzzt`
- **When** WoS+ is asked whether `zzzzt` is a word
- **Then** it is not recognised

### Scenario: nothing is recognised before the list has loaded

- **Given** the shared word list has not loaded
- **When** WoS+ is asked whether any word is a word
- **Then** nothing is recognised — WoS+ treats this as "I don't know", never as
  an error

---

## Building words from the level's letters

### Scenario: only words the tiles can spell are offered

- **Given** the level's letters are `C A U T I O N`
- **When** WoS+ works out which words the board could hold
- **Then** every word it offers can be spelled from those tiles

### Scenario: a tile can only be used once per word

- **Given** the level's letters include exactly one `T`
- **When** WoS+ works out which words the board could hold
- **Then** no word needing two `T`s is offered

### Scenario: repeated tiles can be used as often as they appear

- **Given** the level's letters include two `O`s
- **When** WoS+ works out which words the board could hold
- **Then** words needing two `O`s are offered

### Scenario: words shorter than the level's shortest slot are never offered

- **Given** the shortest slot on the board holds a 5-letter word
- **When** WoS+ works out which words the board could hold
- **Then** no word shorter than 5 letters is offered

### Scenario: the same word is never offered twice

- **Given** the shared word list happens to hold the same word more than once,
  differing only in case
- **When** WoS+ works out which words the board could hold
- **Then** that word is offered once

### Scenario: longer words are offered first

- **Given** several words can be spelled from the level's letters
- **When** WoS+ works out which words the board could hold
- **Then** the longest words come first

---

## Working out which words were missed

At the end of a level WoS+ tells the channel which words were on the board but
never guessed. It prefers to use the archived board, because that is the truth
about what was really there; it falls back to the shared word list when the
board is not in the archive.

### Scenario: the board is in the archive

- **Given** the level's big word is known
- **And** that board is in the archive
- **When** the level ends with some slots unfilled
- **Then** the missed words are exactly the archived board's words for the slots
  nobody filled

### Scenario: the board is not in the archive

- **Given** the level's big word is known
- **And** that board has never been captured
- **When** the level ends with some slots unfilled
- **Then** the missed words are every word WoS+ knows that the level's letters
  can spell and that nobody guessed

### Scenario: the big word was never found

- **Given** the level ends and nobody ever guessed the big word
- **When** the missed words are worked out
- **Then** WoS+ uses the level's known letters and the shared word list, since
  it has no board to look up

### Scenario: words that were guessed are never reported as missed

- **Given** players guessed `ACTION` and `CAUTION` during the level
- **When** the missed words are worked out
- **Then** neither word appears among the missed words, whatever case they were
  typed in

### Scenario: a word already reported as missed is not reported twice

- **Given** the missed words were already worked out once for this level and
  `BEARD` was reported
- **When** the missed words are worked out again — for instance because the
  level ends and then the game ends
- **Then** `BEARD` is not reported a second time

  Missed words are shown with a star after them. That star is part of the
  display, not part of the word, and it must not make the same word look new.

### Scenario: nothing was missed

- **Given** every word on the board was guessed
- **When** the missed words are worked out
- **Then** no missed words are shown

---

## Where new words come from

New words are derived from **boards**, as part of saving one, and that happens
in the database layer. WoS+ itself never adds a word to the shared list: it
reads the list, and the board archive is what grows it.

### Scenario: WoS+ only ever reads the shared word list

- **Given** a level in which players guess words WoS+ does not yet know
- **When** the level plays out and ends
- **Then** WoS+ sends nothing to the shared word list — the words reach it later
  by way of the board being saved

> ✅ **Confirmed (maintainer)** — the client-side add path (`updateWordsDb`,
> and the commented-out `POST` handler on `/api/words`) is deleted, per
> [#171](https://github.com/clarkio/wos-plus/issues/171). Only *adding* was
> retired; reading the list stays exactly as it is, and is still what backs the
> missed-word fallback and masked-guess recovery.

---

## Known limitations

### Scenario: a hidden letter that was never revealed

- **Given** the level ends with a hidden letter still masked, and the big word
  was never found
- **When** the missed words are worked out from the shared word list
- **Then** no word needing that hidden letter is suggested, because WoS+ only
  builds words from the letters it can actually see

> ✅ **Confirmed (maintainer)** — and the premise turns out to be rarer than it
> looked. **Hidden letters are always eventually revealed by the game**, through
> a specific reveal event, so a tile that is still masked when the missed words
> are worked out is not the normal end state.
>
> That is also why this does not really conflict with masked-guess recovery
> treating a hidden tile as standing for any letter: those two run at different
> moments, and by the time missed words are worked out the letter is known.

### Scenario: an archived board whose slots are in a different order

- **Given** the level's board is in the archive
- **And** the level's slots are not in the same order as the archived board's
- **When** the missed words are worked out
- **Then** an archived word is only reported as missed when the slot in the
  *same position* of the current level was also unfilled

> ✅ **Confirmed (maintainer)** — matching by slot position is intended and
> stays. The repair path is what handles a stored board that disagrees with what
> the game presents: a board found to be broken is mended from a clean capture
> rather than worked around at read time. See
> [boards.md § Repairing a board that was stored badly](boards.md).
