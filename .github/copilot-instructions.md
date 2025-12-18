# WoS+ (Words on Stream Plus) - AI Coding Agent Instructions

## Project Overview

**WoS+** is a real-time game enhancement tool for "Words on Stream" (WoS) on Twitch. It provides two interfaces:

- **Player View** ([player.astro](../src/pages/player.astro)): Track words, letters, and personal records
- **Streamer View** ([streamer.astro](../src/pages/streamer.astro)): OBS-ready layout with embedded game board and Twitch chat

Built with **Astro 5 + TypeScript**, deployed to **Cloudflare Pages** with Workers for serverless API routes.

## Architecture

### Core Components

1. **Game State Manager** ([wos-plus-main.ts](../src/scripts/wos-plus-main.ts))

   - `GameSpectator` class orchestrates all game tracking
   - Connects to WoS WebSocket (Socket.IO v2) and Twitch chat (tmi.js)
   - Uses two Web Workers for message processing to prevent blocking UI
   - Maintains slot-based game state with `currentLevelSlots` tracking words at specific indices

2. **Web Workers** - **Critical**: Both workers use `postMessage` for async communication

   - [wos-worker.ts](../src/scripts/wos-worker.ts): Processes 12 WoS event types (1=LevelStart, 3=CorrectGuess, 4=LevelResults, 5=GameEnded, 10=LettersRevealed, 12=GameConnected)
   - [twitch-chat-worker.ts](../src/scripts/twitch-chat-worker.ts): Filters chat messages matching `/^[a-zA-Z]{4,12}$/`

3. **Dictionary System** ([wos-words.ts](../src/scripts/wos-words.ts))

   - Remote dictionary loaded from `https://clarkio.com/wos-dictionary`
   - `findWosWordsByLetters()`: Letter frequency matching algorithm
   - `findAllMissingWords()`: Identifies potentially missed words at level end
   - Words auto-added to dictionary via PATCH when correctly guessed

4. **API Routes** ([src/pages/api/](../src/pages/api/)) - All require `prerender = false`
   - Access Cloudflare env via `locals.runtime.env` (e.g., `env.SUPABASE_URL`)
   - Supabase client created per-request in each handler

### Key Data Flows

```
WoS Event Flow:
Socket.IO → wos-worker → GameSpectator.handleCorrectGuess() → updateCurrentLevelSlots[index] → UI

Hidden Word Resolution (Level 20+):
WoS sends "????" → Match username + timestamp → Twitch chat log → Reveal actual word

Missing Word Detection:
Level ends → logMissingWords() → findAllMissingWords(knownLetters, minLength) → Display with * suffix
```

## Development Workflows

```bash
npm run dev         # Astro dev server on http://localhost:4321
npm run build       # Build for Cloudflare Pages
npm run preview     # Build + Wrangler local preview (tests Workers)

# Database scripts (require SUPABASE_URL and SUPABASE_KEY env vars)
npm run db:fix-board-ids
npm run db:insert-words-from-boards -- --apply
```

### Environment Variables

Required in **Cloudflare Pages dashboard** (not .env):

- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_KEY`: Supabase service key

## Project Conventions

### TypeScript Patterns

- Trust type inference for simple variables (`let level = 0`)
- Define interfaces in worker files (`WosWorkerMessage`, `TwitchWorkerResult`)
- Use inline types for slots: `{ letters: string[], user?: string, hitMax: boolean, index: number, length: number }`

### Astro-Specific

- All game logic runs **client-side** in `<script>` tags (no SSR for game state)
- **Query params drive configuration**: `?mirrorUrl=...&twitchChannel=...&clearSound=true`
- Settings dialogs use `SettingsDialog.astro` component with `__api` pattern for programmatic control
- Page initialization listens to both `DOMContentLoaded` and `astro:page-load` for ViewTransitions

### State Management

- **No framework state**: Pure DOM manipulation via `document.getElementById()`
- **localStorage keys**: Prefixed pattern `pb_${channel}`, `pb_${channel}_${date}`, `clears_${channel}_${date}`
- Missing required params triggers settings dialog automatically

### UI Rendering

```typescript
// Words grouped by length, sorted alphabetically, missed words marked with *
const groupedWords = sortedWords.reduce((map, word) => {
  const key = word.replace("*", "").length;
  map.get(key)!.push(word);
  return map;
}, new Map<number, string[]>());
```

## Adding Features

### New WoS Event Handler

1. Add case in [wos-worker.ts](../src/scripts/wos-worker.ts) `onmessage`
2. Create handler method in `GameSpectator` class
3. Route in `startEventProcessors()` switch statement

### New Settings Option

1. Add input to `SettingsDialog` form in page's `.astro` file
2. Handle in `setupDialogCallbacks()` → add to URL params
3. Read in `initializePage()` and apply to `spectator` instance

### New API Route

1. Create file in `src/pages/api/` with `.ts` extension
2. Add `export const prerender = false;` at top
3. Access env via `const { env } = locals.runtime;`

## External Dependencies

| Service     | Purpose                | Connection                            |
| ----------- | ---------------------- | ------------------------------------- |
| WoS API     | Game events            | `wss://wos2.gartic.es` (Socket.IO v2) |
| Dictionary  | Word validation        | `https://clarkio.com/wos-dictionary`  |
| Twitch Chat | Hidden word resolution | IRC via `@tmi.js/chat`                |
| Supabase    | Board/word storage     | REST API (on 5-star clears)           |

## Known Edge Cases

See [LIST.todo](../LIST.todo) for active bugs. Critical scenarios:

- Multiple `?` hidden letters revealed at different times
- Chat message timing mismatches for hidden word resolution
- Big word detection when fake letters still present
- Slot-based missed word detection not yet implemented (see [plan-slotBasedMissedWordsDetection.prompt.md](../plan-slotBasedMissedWordsDetection.prompt.md))
