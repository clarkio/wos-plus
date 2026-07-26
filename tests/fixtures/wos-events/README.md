# WoS event fixtures

Input payloads for `src/scripts/wos-worker.ts`, used by
`tests/unit/wos-worker.test.ts`.

Each file is exactly what `wos-plus-main.ts` posts into the worker for a WoS
socket event:

```ts
this.wosSocket.on('3', (eventType, data) => wosWorker.postMessage({ eventType, data }));
```

so a fixture is `{ "eventType": <number>, "data": <socket payload> }`.

## Provenance — what is known and what is inferred

**These fixtures are not captured from a live socket session.** They were
derived from the code that produces and consumes the payloads. Read the table
before trusting any field as protocol truth.

| Field | Status | Evidence |
| --- | --- | --- |
| `eventType` numbers 1, 3, 4, 5, 7, 8, 10, 11, 12 | **Known** | Branches in `wos-worker.ts`; names come from that file's `wosEventName` strings. |
| `data.user.name` | **Known** | `wos-worker.ts` reads `data.user?.name`; the legacy handler kept in comments at the bottom of `wos-plus-main.ts` reads `data.user.name`. |
| `data.letters` (array of single-character strings) | **Known** | `data.letters.join('')` / `data.letters.length` in the legacy handler; `letters.join(' ')` in `handleGameInitialization`. |
| `'?'` placeholders inside `data.letters` | **Known** | `updateGameState()` branches on `word.includes('?')` for hidden words (level 19+), and `handleLetterReveal()` fills `'?'` slots. |
| `data.hitMax` (boolean) | **Known** | `data.hitMax === true` in the legacy handler; drives big-word detection. |
| `data.index` (number) | **Known** | Used as the slot index in `updateCurrentLevelSlots()`. |
| `data.stars` (number) on event 4 | **Known** | `data.stars` in the legacy handler; a real recorded event-4 payload is quoted in `LIST.todo`. |
| `data.ranking` / `data.rankingTurn` on event 4 | **Known (recorded)** | Copied — abridged to three entries — from the real event-4 payload recorded in `LIST.todo` lines 12–102. The worker drops both fields; the fixture keeps them to prove that. |
| `data.level` (number) on events 1 and 12 | **Known** | `wos-worker.ts` asserts `data.level!` for both; `handleGameInitialization()` does `parseInt(level)`. |
| `data.record` on event 12 | **Known** | `wos-worker.ts` only copies `data.record` onto the result for event 12. |
| `data.language` (1 = pt, 2 = en, 4 = fr) | **Known** | Documented in `WosWorkerMessage` and mapped by `wosLanguageIdToCode()` in `src/lib/board-utils.ts`. |
| `data.hiddenLetters` / `data.falseLetters` on event 10 | **Known** | Both read by `wos-worker.ts` and by `handleLetterReveal()`. |
| `data.slots` **element shape** | **INFERRED** | The worker passes `slots` through untouched, so its shape is invisible to the worker. The fixtures use the `Slots` type declared in `wos-plus-main.ts` (`{ letters, word, user?, hitMax, index, length }`), which is also the shape the existing `wos-plus-main` tests use. Whether WoS itself sends exactly these keys (or, e.g., omits `word`/`user` for unguessed slots) is **not verified**. |
| `data.level` on events 5 and 8 | **INFERRED** | Nothing reads `level` for these events. Included only so the fixtures aren't empty; the value is made up. |
| `data.letters` on event 7 (Letters Cycled) | **INFERRED** | The name suggests a re-ordered letter set, and the worker copies `data.letters` for every event, but no consumer reads it for event 7. The specific array is made up. |
| Event 11 (Guessing Unlocked) payload | **INFERRED** | Unknown; modelled as an empty object. Nothing in this repo reads any field of it. |
| Event types **2, 6, 9** | **UNKNOWN** | `wos-worker.ts` has no branch for them and no code or documentation in this repo describes them. The `0N-unknown-unhandled.json` fixtures carry an empty `data` on purpose: rather than invent a payload, they only pin the contract the worker actually has for unhandled types — no `postMessage`, no throw. |

`copilot-instructions.md` says the worker "processes 12 WoS event types". It in
fact has explicit branches for **nine** types; the numbering runs 1–12 with 2,
6 and 9 unhandled. The test table has a row for all twelve numbers so that
distinction is visible at a glance.

## Malformed input

Malformed cases (null message, missing `data`, wrong types, empty payload) are
built inline in `tests/unit/wos-worker.test.ts` rather than stored here — they
are deliberately-broken inputs, not protocol samples, and keeping them in the
test keeps the "what breaks" next to "what should happen".
