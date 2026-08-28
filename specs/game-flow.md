# Game flow

This describes what a player or streamer sees while WoS+ follows a live game,
from connecting through to the end of a level.

WoS+ watches two things at once: the game itself (which tells it when a level
starts, when a word is guessed, and how a level ended) and the channel's Twitch
chat (which is how it recovers a word the game deliberately masks).

Related: [boards.md](boards.md) covers what happens to a captured board;
[words.md](words.md) covers how missed words are chosen;
[channel-stats.md](channel-stats.md) covers the record badges.

---

## Is WoS+ itself up?

### Scenario: checking that WoS+ is running

- **Given** someone wants to know whether WoS+ is available — a monitor, or a
  streamer whose overlay has gone blank
- **When** they ask WoS+ whether it is running
- **Then** WoS+ answers that it is running, and says when it answered

  This check never touches the board archive, the word list or the channel
  records, so it stays truthful about WoS+ itself even when everything behind it
  is unavailable.

---

## Connecting

### Scenario: connecting to a game

- **Given** a streamer supplies the link to their Words on Stream mirror
- **When** WoS+ connects
- **Then** it starts following that game

### Scenario: the link is not a Words on Stream mirror

- **Given** a streamer supplies a link that does not point at a Words on Stream
  game room
- **When** WoS+ tries to connect
- **Then** it does not connect, and the game log says the mirror link is invalid

  The board that viewers see is driven straight from this link, so anything but
  a real game room is refused rather than shown.

### Scenario: connecting to a Twitch channel

- **Given** a streamer supplies their channel name, with or without a leading
  `#`
- **When** WoS+ connects to Twitch chat
- **Then** it follows that channel's chat and loads that channel's records

### Scenario: joining the channel does not confirm straight away

- **Given** WoS+ is connecting to a Twitch channel
- **And** the join is not confirmed — which happens routinely in an OBS browser
  source on a live stream
- **When** the join fails
- **Then** WoS+ retries, waiting a little longer each time, up to five attempts,
  logging each one, and the stream is otherwise unaffected

### Scenario: switching channels mid-stream

- **Given** WoS+ is still retrying a join for one channel
- **When** the streamer connects it to a different channel
- **Then** the old retries stop and only the new channel is followed

---

## Starting a level

### Scenario: a level starts

- **Given** WoS+ is following a game
- **When** a new level starts
- **Then** the level number is shown, the level's letters are shown, the board's
  empty slots are taken up, and everything from the previous level — the words
  found, the big word, the hidden and fake letters, and the chat history kept
  for matching — is cleared away

### Scenario: joining a game already in progress

- **Given** a level is already under way when WoS+ connects
- **When** WoS+ picks the game up
- **Then** the current level number and the board's slots are adopted, the game
  log notes the level is in progress rather than started, and nothing already on
  screen is cleared

### Scenario: reconnecting to a level with no masked guesses

- **Given** WoS+ was following a level with no masked guesses in it
- **And** players kept guessing while WoS+ was away
- **When** the connection comes back and WoS+ picks the level up again
- **Then** the level number and the board's slots are adopted afresh from the
  game, and the found-words list is rebuilt from those slots — so the words
  found during the outage appear in the list as well as on the board

### Scenario: reconnecting to a level that has masked guesses

- **Given** WoS+ was following a level in which guesses arrive masked
- **And** players kept guessing while WoS+ was away
- **When** the connection comes back and WoS+ picks the level up again
- **Then** the slots are adopted afresh, but the found-words list is **left with
  its gap** — the words missed during the outage are not added

  A masked guess cannot be recovered after the fact: the chat message that
  would have named it has passed, and the game reports the slot as filled
  without saying with what. A visible gap in the list is better than a guessed
  word or a blank in it.

  This is the same split as an unrecoverable masked guess at the end of a level
  (see § Approved, not yet implemented): whether a slot is **filled** and what
  **word** fills it are two separate facts, and WoS+ can know the first without
  the second.

> ✅ **Confirmed (maintainer)** — WoS+ now tells a reconnection apart from
> joining a game in progress for the first time: the WOS socket reporting a
> recovered connection marks the next "level in progress" event as a genuine
> reconnect, and only that case rebuilds the found-words list from the
> re-reported slots. Joining a level already in progress on the very first
> connect still leaves the found-words list empty, since there is nothing to
> rebuild it from. Fixed per
> [#169](https://github.com/clarkio/wos-plus/issues/169).

### Scenario: the game's word language is noticed

- **Given** the game is being played in French
- **When** WoS+ sees any event from the game carrying the language
- **Then** the game log notes the language, and boards captured from then on
  record it

### Scenario: an unfamiliar language leaves the current one alone

- **Given** WoS+ has already worked out the game's language
- **When** a later event carries a language WoS+ does not recognise, or none at
  all
- **Then** the language WoS+ already knows is kept

  Only the three languages Words on Stream plays in — English, Portuguese and
  French — are ever accepted as the game's language. Nothing outside that set is
  taken up, and a board captured without a known language is not saved at all;
  see [boards.md](boards.md).

---

## A correct guess

### Scenario: a player guesses a word

- **Given** a level is under way
- **When** the game reports that `clarkio` correctly guessed `ACTION` into the
  third slot
- **Then** `ACTION` appears in the list of found words, and the third slot shows
  the word and that `clarkio` found it

### Scenario: found words are ordered by length and then alphabetically

- **Given** several words have been found this level
- **When** the found-words list is shown
- **Then** shorter words come before longer ones, and words of the same length
  are in alphabetical order, grouped by length

### Scenario: a missed word is marked and sorted after the same word found

- **Given** the found-words list is shown after a level ended
- **When** it contains both words that were found and words that were missed
- **Then** the missed words carry a star, and a missed word sorts after an
  identical found word

### Scenario: the big word is guessed

- **Given** a level is under way
- **When** a player guesses the big word — the one that uses every real letter
- **Then** the board's letters display becomes the big word, labelled as the big
  word rather than as the letters, and WoS+ works out which of the board's
  letters were hidden and which were fake

### Scenario: a board with more than one big word shows the alphabetically last

- **Given** a level whose big word has anagrams — for example `BEDROOM`,
  `BOREDOM` and `BROOMED` — and one of them has already been guessed
- **When** another of them is guessed
- **Then** the big word on display is whichever of the big words guessed **so
  far** sorts last alphabetically, regardless of the order they were guessed in

  The display used to follow the most recent guess, so it changed under the
  player every time another anagram was found. Settling on the alphabetically
  last one guessed keeps it steady: it only ever moves forward through the
  alphabet, and it matches the rule already used to pick a board's canonical id
  in [boards.md](boards.md).

  Only big words actually guessed this level are candidates — WoS+ does not
  reach into the dictionary to display an anagram nobody has found yet.

---

## Hidden and fake letters

A board may include tiles the game keeps masked (**hidden letters**, shown as
`?`) and tiles that are not really in play at all (**fake letters**). WoS+ works
them out in two ways: by deduction from the words players guess, and from the
game's own reveal near the end of the level.

### Scenario: a hidden letter is deduced from a guess

- **Given** the level's visible letters are `T L R I S M ? B`
- **When** a player correctly guesses `TRILBY`
- **Then** WoS+ concludes `Y` is a hidden letter, shows it as a hidden letter,
  and puts it in place of the `?` in the letters display

  A word can only be built from tiles that are really on the board, so a letter
  used more times than the visible tiles allow must be behind a mask.

### Scenario: deducing the same hidden letter twice changes nothing

- **Given** WoS+ has already deduced that `Y` is hidden
- **When** another guess would lead to the same conclusion
- **Then** `Y` is still shown exactly once

### Scenario: a second hidden letter found later is added, not substituted

- **Given** WoS+ has already deduced one hidden letter
- **When** a later guess reveals another one
- **Then** both hidden letters are shown

### Scenario: the game reveals the hidden and fake letters

- **Given** the big word has not been guessed yet
- **When** the game reveals which letters were hidden and which were fake
- **Then** the fake letters are dropped from the board's letters, each masked
  tile is filled with one revealed hidden letter, any masked tile with no letter
  to fill it is dropped, and both the hidden and fake letters are shown

  Filling masks one-for-one matters: if a reveal repeats, or names a letter that
  was already visible, simply adding it would invent a tile that was never on
  the board, and every missed-word calculation afterwards would be wrong.

### Scenario: the reveal after the big word is already known

- **Given** the big word has already been guessed, so WoS+ knows every real
  letter
- **When** the game reveals the hidden and fake letters
- **Then** the revealed letters are shown, but the board's letters are left as
  they are

### Scenario: a level with several big words

- **Given** a level whose big word has anagrams — for example `BROOMED`,
  `BEDROOM` and `BOREDOM`
- **When** each of them is guessed in turn
- **Then** the hidden letters are worked out once, and re-working them out for
  each anagram does not add duplicates

---

## Masked guesses

From **level 19 onwards** the game stops telling WoS+ which word was guessed: it
reports only who guessed and how many letters the word had. WoS+ recovers the
word from what that player typed in chat.

> ✅ **Confirmed (maintainer)** — level 19 and above. This is the *game's*
> threshold, not one WoS+ enforces: WoS+ never compares the level number, and
> takes the masked path purely because the word arrives with `?` in it. That is
> deliberate — if Words on Stream ever moves the threshold, WoS+ keeps working
> and this line is what gets updated.

### Scenario: a masked guess is recovered from chat

- **Given** `clarkio` typed `trilby` in chat a moment ago
- **When** the game reports that `clarkio` correctly guessed a 6-letter word
  without saying which
- **Then** `TRILBY` is shown as found and fills the slot

### Scenario: a real word that fits the board is preferred

- **Given** `clarkio` typed both `trilby` and `zzzzzz` in chat, both 6 letters
- **When** a 6-letter masked guess from `clarkio` is reported
- **Then** `trilby` is chosen, because it is a word WoS+ knows and it can be
  spelled from the level's tiles

### Scenario: a still-masked tile can stand for any letter when matching

- **Given** the level still has a masked tile
- **When** WoS+ checks whether a chat word could have been built from the
  board's tiles
- **Then** the masked tile is allowed to stand for whichever letter that word
  needs

### Scenario: the most recent matching message wins

- **Given** `clarkio` typed several different 6-letter words that all fit the
  board
- **When** a 6-letter masked guess from `clarkio` is reported
- **Then** the most recently typed one is chosen

### Scenario: two masked guesses from the same player resolve to different words

- **Given** `clarkio` typed `trilby` and then `broods` in chat
- **When** two 6-letter masked guesses from `clarkio` are reported in quick
  succession
- **Then** they resolve to two different words — a message already used for one
  guess is never reused for another

### Scenario: a word already on the board is not chosen again

- **Given** `ACTION` is already in a slot
- **And** `clarkio` typed `action` in chat
- **When** a 6-letter masked guess from `clarkio` is reported
- **Then** `action` is not chosen, because the game does not accept a word
  already on the board

  This is what stops a re-typed chat message from filling a second slot with a
  duplicate word — the mistake that put boards with repeated words in the
  archive in the first place.

### Scenario: no matching chat message

- **Given** `clarkio` typed nothing of the right length that could be the word
- **When** a masked guess from `clarkio` is reported
- **Then** WoS+ notes it could not work out the word, and nothing is added to
  the found words
- **And** the slot is still recorded as filled by `clarkio`, masked, so the
  level can still count as a clear — but the word stays unknown, so it is not
  reported as missed and the slot's word can never enter a saved board

> ✅ **Confirmed (maintainer)**, implemented in
> [#167](https://github.com/clarkio/wos-plus/issues/167) — a slot filled by an
> unrecoverable masked guess counts as filled (the clear is credited, the word
> is not reported missed), but the board is **not** saved or updated, because
> one of its words is not known. These two outcomes are deliberately decoupled:
> a player really did fill that slot, so the clear is real, but WoS+ cannot say
> *which* word filled it, and a board with a blank/masked word must never enter
> the archive — every future level would read that back as truth. Draft PR #144
> was closed as superseded; the fix landed as new work on `main` instead
> (`updateGameState` in `wos-plus-main.ts` records the slot masked rather than
> dropping it, and `saveBoard`'s existing `?`-bearing-slot guard keeps it out of
> the boards table).

### Scenario: only the last messages a player typed are considered

- **Given** a player has typed many messages during the level
- **When** a masked guess from that player is reported
- **Then** only their 25 most recent messages are considered

### Scenario: an ordinary guess never goes near chat

- **Given** the game reports a correct guess and says which word it was
- **When** WoS+ handles it
- **Then** the word from the game is used directly, whatever is in chat

  Chat matching is a last resort. Two players guessing at nearly the same moment
  used to be able to knock each other's words out; trusting the game whenever it
  tells us the word removes that risk from every level below the masking
  threshold.

---

## Ending a level

### Scenario: a last-moment guess still counts

- **Given** a player's guess is accepted in the final instant of a level
- **When** the level ends
- **Then** WoS+ waits briefly before reading the board, so that guess is counted
  before the results are worked out

### Scenario: the level advances by the stars earned

- **Given** the channel is on level 12
- **When** the level ends with 3 stars
- **Then** the level shown becomes 15, labelled as the next level

### Scenario: a cleared board is captured

- **Given** a level ends with every slot filled with a word
- **And** the big word is known
- **When** the results are worked out
- **Then** the board is captured
- **And** the clear sound plays, if the clear sound is switched on

  A clear is about the **board**, not about any one player. Levels are normally
  played by many people at once, and it makes no difference who found which
  word — the level counts as a clear as soon as every slot is filled, however
  the credit is spread.

  The clear sound is a setting in both views. When it is switched off the level
  is still a clear and the board is still captured; only the sound is skipped.

### Scenario: five stars counts as a clear

- **Given** a level ends with 5 stars
- **When** the results are worked out
- **Then** it is treated as a clear

### Scenario: a level that was not cleared

- **Given** a level ends with some slots never filled
- **When** the results are worked out
- **Then** the words that were missed are shown with a star beside them, and the
  game log summarises how many words of each length were missed, shortest first

### Scenario: the near-miss and decent-effort sounds

- **Given** a level ends without being cleared
- **And** the sounds are switched on
- **When** it ended with 1 star
- **Then** the near-miss sound plays
- **And when** it ended with 3 stars
- **Then** the decent-effort sound plays

  Every sound WoS+ plays is behind the same setting. When it is switched off no
  sound plays, and nothing else about the level changes.

### Scenario: the game ends

- **Given** the channel's run comes to an end
- **When** the game ends
- **Then** the game log records the level the run ended on, the missed words are
  shown, and the end-of-game sound plays if the sounds are switched on

### Scenario: records are refreshed after a level

- **Given** a level has just ended
- **When** WoS+ refreshes the channel's records
- **Then** it waits long enough for the chatbot to have written the level, and
  the numbers on screen never go down (see
  [channel-stats.md](channel-stats.md))

---

## Sounds

### Scenario: sounds turned off

- **Given** the viewer has turned sounds off
- **When** any event that would play a sound happens
- **Then** nothing is played

### Scenario: the view is not visible

- **Given** the WoS+ view is in a background tab
- **When** events that would play sounds happen
- **Then** nothing is played, and nothing is queued up to play later

  A hidden tab has its timers throttled, so several levels' worth of sounds
  would otherwise all fire at once the moment the viewer came back.

---

## Chat handling

### Scenario: only plausible guesses are kept from chat

- **Given** the channel's chat is busy with conversation
- **When** messages arrive
- **Then** only messages that are a single run of 4 to 12 letters are kept as
  possible guesses; everything else is ignored

### Scenario: chat is shown as it arrives

- **Given** WoS+ is following the channel's chat
- **When** a message arrives that could be a guess
- **Then** it is shown in the chat log with the sender's name

---

## Approved, not yet implemented

### Scenario: a masked guess longer than a word can be

- **Given** a masked guess of 13 or more letters arrives
- **When** WoS+ tries to recover it from chat
- **Then** it is not recovered, because a guess that long is longer than any
  word the game plays

  Chat messages of 4 to 12 letters are kept for matching. Twelve is a cushion
  over the longest word in the shared word list, which is 8 letters, so a
  13-letter guess is not a word being missed — it is a sign something else is
  wrong.

> ✅ **Confirmed (maintainer)** — the 12-letter chat filter is right and stays.
> The **board name rule** is what moves: it allows up to 20 today, and comes
> down to 12 to match. Tracked by
> [#168](https://github.com/clarkio/wos-plus/issues/168) — see the migration
> warning in [boards.md](boards.md), since lowering it can strand an
> already-stored board.

---

## Known limitations

### Scenario: a guess for a slot that is not on the board

- **Given** the game reports a correct guess for a slot position that the
  current board does not have
- **When** WoS+ handles it
- **Then** a warning is logged and no slot is filled, but the word is still
  shown in the found-words list

> ✅ **Confirmed (maintainer)** — this should never happen. What the game
> reports about its own board is the source of truth, so a guess for a slot the
> board does not have means something already went wrong earlier in WoS+ —
> most likely that it took up the wrong board data at the start of the game or
> level. The disagreement between the found-words list and the board is a
> *symptom*; the defect is upstream of it.
>
> Left as described rather than "fixed" at the point of the symptom: tidying the
> display here would hide the only signal that the board data is wrong.

### Scenario: the streamer's own personal best while the chatbot lags

- **Given** the channel has just reached a new highest level
- **When** the records are refreshed before the chatbot has written it down
- **Then** the number on screen stays at whatever WoS+ last showed, rather than
  rising to the level just reached

> ✅ **Confirmed (maintainer)** — intended. What the chatbot captures is the
> source of truth, and the screen catches up once that data is written. Raising
> the number optimistically from what WoS+ believes just happened would risk
> races and mismatched data between the two, which is worse than a number that
> arrives a moment late.
>
> This is about a level reached **during play**. It does not conflict with the
> all-time best the game reports **on connect**, which does win over the stored
> value — see [channel-stats.md](channel-stats.md).
