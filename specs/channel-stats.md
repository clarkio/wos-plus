# Channel stats

WoS+ shows three numbers for the connected Twitch channel:

- **all-time best** — the highest level the channel has ever reached
- **daily best** — the highest level the channel has reached today
- **daily clears** — how many boards the channel has cleared today

The two daily numbers are written by **the chatbot**, and only channels that
have the chatbot enabled have them. Channels without the chatbot see only the
all-time best.

"Today" means the current day in UTC, so the daily numbers reset at the same
moment for every channel regardless of where the streamer lives.

Related: [game-flow.md](game-flow.md) covers when these numbers are refreshed
during a stream.

---

## Naming a channel

Twitch channel names are made of letters, digits and underscores, and are at
most 50 characters long. WoS+ treats a channel name as the same channel whatever
case it is typed in.

### Scenario: the channel name is typed with capitals

- **Given** the channel `clarkio` has records
- **When** stats are requested for `ClarkIO`
- **Then** the same channel's records come back

### Scenario: the channel name has stray spacing

- **Given** the channel `clarkio` has records
- **When** stats are requested for `  clarkio  `
- **Then** the same channel's records come back

### Scenario: a channel name containing characters Twitch does not allow

- **Given** stats are requested for `clark.io`
- **When** WoS+ handles the request
- **Then** it is rejected as an invalid channel name and no records are looked
  up

### Scenario: a channel name that is too long

- **Given** stats are requested for a channel name longer than 50 characters
- **When** WoS+ handles the request
- **Then** it is rejected as an invalid channel name length and no records are
  looked up

### Scenario: no channel name at all

- **Given** stats are requested with no channel name
- **When** WoS+ handles the request
- **Then** it is rejected because a channel name is required

---

## Reading a channel's records

### Scenario: a channel with the chatbot and a full set of records

- **Given** the channel `clarkio` has the chatbot enabled
- **And** it has reached level 42 at some point, level 30 today, and cleared 3
  boards today
- **When** its stats are read
- **Then** the all-time best is 42, the daily best is 30, the daily clears are
  3, and the channel is reported as having the chatbot

### Scenario: a channel without the chatbot

- **Given** the channel `somestreamer` does not have the chatbot enabled
- **When** its stats are read
- **Then** the channel is reported as not having the chatbot, and the daily
  best and daily clears come back as zero

### Scenario: a channel WoS+ has never seen

- **Given** the channel `brandnew` has no records of any kind
- **When** its stats are read
- **Then** all three numbers come back as zero and the channel is reported as
  not having the chatbot — this is a normal answer, not a failure

### Scenario: a channel with an all-time best but nothing yet today

- **Given** the channel `clarkio` has an all-time best of 42
- **And** it has not played yet today
- **When** its stats are read
- **Then** the all-time best is 42 and both daily numbers are zero

### Scenario: yesterday's daily numbers do not carry over

- **Given** the channel `clarkio` reached level 30 and cleared 2 boards
  yesterday
- **And** it has not played yet today
- **When** its stats are read
- **Then** the daily best and daily clears are zero

### Scenario: whether the channel has the chatbot cannot be determined

- **Given** the records for `clarkio` can be read
- **And** WoS+ cannot tell whether the channel has the chatbot
- **When** its stats are read
- **Then** the channel is treated as **not** having the chatbot

  This fails on the safe side: an empty daily badge on screen looks broken, so
  when in doubt WoS+ hides the daily badges rather than showing blanks.

### Scenario: the records cannot be reached at all

- **Given** the channel records are unavailable
- **When** stats are read
- **Then** WoS+ is told the read failed, and no numbers come back

---

## Showing the records on screen

### Scenario: the numbers appear when a channel is connected

- **Given** a player or streamer connects WoS+ to the channel `clarkio`
- **When** the connection is made
- **Then** the all-time best, daily best and daily clears for that channel are
  shown

### Scenario: the daily badges are hidden for channels without the chatbot

- **Given** WoS+ is connected to a channel that does not have the chatbot
- **When** the numbers are shown
- **Then** the daily best and daily clears badges are hidden entirely, and the
  all-time best badge stays visible

  A channel without the chatbot has no daily numbers to show, and an empty badge
  just takes up space on the stream.

### Scenario: a refresh never lowers a number already on screen

- **Given** the daily best on screen is 30
- **And** a refresh comes back with a daily best of 28, because the chatbot has
  not written the latest level yet
- **When** the numbers are updated
- **Then** the daily best on screen stays at 30

  The stream is the source of truth for what just happened. A refresh may only
  ever raise these numbers.

### Scenario: a refresh with nothing connected

- **Given** WoS+ is not connected to any channel
- **When** a refresh is attempted
- **Then** nothing is read and nothing on screen changes

### Scenario: a failed refresh leaves the numbers alone

- **Given** the numbers on screen are 42, 30 and 3
- **And** the channel records cannot be reached
- **When** a refresh is attempted
- **Then** the three numbers on screen are unchanged

### Scenario: large numbers still fit on one row

- **Given** the level and the three record badges together are wider than the
  space available
- **When** they are shown
- **Then** the whole row is scaled down so it stays on a single line, and it is
  never scaled up beyond its normal size

---

## Open questions for the maintainer

### Scenario: a channel name written the way a streamer would type it

- **Given** stats are requested for `#clarkio`
- **When** WoS+ handles the request
- **Then** it is rejected as an invalid channel name

> ❓ **Unconfirmed** — this reflects current behaviour; maintainer to confirm it
> is intended. When a channel name is recorded on a captured board, a leading
> `#` is stripped and the name is accepted (see [boards.md](boards.md)); when
> stats are read, the same name is rejected. Streamers write channel names both
> ways, so the two paths probably should agree.

### Scenario: a temporary failure hides the daily badges

- **Given** WoS+ is connected to a channel that has the chatbot, and the daily
  badges are visible
- **And** the channel records briefly cannot be reached
- **When** a refresh is attempted
- **Then** the numbers stay as they were, but the daily badges disappear until a
  later refresh succeeds

> ❓ **Unconfirmed** — this reflects current behaviour; maintainer to confirm it
> is intended. The numbers themselves are deliberately protected from a failed
> refresh, but whether the channel has the chatbot is not, so badges can flicker
> away mid-stream on a blip.

### Scenario: the all-time best the game itself reports

- **Given** WoS+ connects to a running game that reports the channel's record
  level
- **When** the connection is made
- **Then** that number is ignored, and the all-time best shown comes only from
  the stored channel records

> ❓ **Unconfirmed** — this reflects current behaviour; maintainer to confirm it
> is intended. The game does send a record with its connection, and a note in
> the code says the all-time best comes from the game, but nothing reads it.
> Either the note is stale or the number should be used.
