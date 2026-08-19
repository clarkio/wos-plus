# Settings

This describes what a player or streamer sees when they configure WoS+ — the
settings dialog on both views, and what happens when WoS+ is opened with
settings already supplied in the link.

WoS+ has two views. The **player view** is the one someone watches in a
browser. The **streamer view** is the one a streamer puts in an OBS browser
source so their viewers see it on the stream. Both follow the same game and
both are configured the same way.

Related: [game-flow.md](game-flow.md) covers connecting to a game and a Twitch
channel once the settings are supplied.

---

## The two views offer the same settings

### Scenario: the same settings are available on both views

- **Given** someone opens either the player view or the streamer view
- **When** they open the settings
- **Then** they are offered the same choices on both: which Words on Stream
  mirror to follow, which Twitch channel to follow, whether to show Twitch
  chat, whether to show the Words on Stream board, and whether to play sounds

  The two views differ in how they are laid out — one is built to be watched in
  a browser, the other to be embedded in a stream — but not in what can be
  configured. A setting that exists on one exists on the other.

---

## Opening WoS+ with settings already supplied

A WoS+ link carries its settings, so a streamer can save one link and reuse it.
The mirror and the channel are both required; the three toggles are optional
and default to on.

### Scenario: the link carries everything WoS+ needs

- **Given** a link supplying both a valid Words on Stream mirror and a valid
  Twitch channel
- **When** WoS+ opens
- **Then** it starts following that game and that channel without asking for
  anything

### Scenario: the link is missing something WoS+ needs

- **Given** a link that omits the mirror, or omits the Twitch channel
- **When** WoS+ opens
- **Then** it asks for the missing setting instead of connecting

### Scenario: the link carries something WoS+ cannot use

- **Given** a link supplying a mirror that is not a Words on Stream game room,
  or a channel name that could not belong to a Twitch account
- **When** WoS+ opens
- **Then** it asks for the setting again rather than connecting

  A link that WoS+ cannot use is treated the same as one that is missing the
  setting entirely. In particular the board is never pointed at whatever the
  link happened to contain — see the mirror-link scenario in
  [game-flow.md](game-flow.md).

### Scenario: what WoS+ shows back when a setting cannot be used

- **Given** WoS+ has asked for a setting again because the link carried
  something it could not use
- **When** the person looks at the settings
- **Then** the value from the link is still shown, so they can see what was
  wrong and correct it rather than retyping it

  This holds on both views. Discarding what someone supplied and presenting an
  empty box tells them nothing about why they were asked again, and loses a
  channel name or mirror link that may only differ from a working one by a
  character.

---

## Changing settings

### Scenario: saving new settings

- **Given** someone has opened the settings and changed something
- **When** they save
- **Then** the new settings take effect immediately, and the link updates to
  carry them, so reopening that link later restores the same setup

### Scenario: saving a mirror WoS+ cannot use

- **Given** someone types a mirror link that does not point at a Words on
  Stream game room
- **When** they save
- **Then** the settings stay open and say the mirror link is invalid, and
  nothing is changed

### Scenario: saving a channel WoS+ cannot use

- **Given** someone types a channel name that could not belong to a Twitch
  account, or that belongs to no Twitch account
- **When** they save
- **Then** the settings stay open and say the channel name is invalid, and
  nothing is changed

  Where WoS+ cannot reach Twitch to check whether the account exists, it does
  not block saving — an unreachable lookup is not evidence the channel is
  wrong.

### Scenario: reopening the settings

- **Given** someone has WoS+ running with settings in effect
- **When** they open the settings again
- **Then** every box shows the setting currently in effect

---

## Showing and hiding parts of the view

### Scenario: hiding Twitch chat

- **Given** someone turns Twitch chat off
- **Then** the chat is hidden and the rest of the view takes the space it used

### Scenario: hiding the Words on Stream board

- **Given** someone turns the board off
- **Then** the board is hidden and stops being loaded at all

  A hidden board is not merely covered up — WoS+ stops pulling it, so a
  streamer who only wants the word list is not still fetching a board nobody
  sees.

### Scenario: a setting the link does not mention

- **Given** a link that says nothing about chat, the board, or sounds
- **When** WoS+ opens
- **Then** all three are on
