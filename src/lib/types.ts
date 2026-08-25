/**
 * Domain types shared across the client scripts and the server routes.
 *
 * Kept here rather than in any one consumer so nothing has to import from a
 * module it otherwise has no business depending on — `wos-plus-main.ts`
 * should not have to reach into the dictionary module for the shape of a
 * board slot (issue #134).
 */

/**
 * One slot on a Words on Stream board: a single word's worth of letters, and
 * who guessed it if anyone has.
 *
 * This is the union of the three declarations it replaces, so every previous
 * consumer still type-checks:
 *
 * - `user` is `string | null | undefined`. All three states occur: the game
 *   payload omits it for an unguessed slot, the database stores `null`, and
 *   `updateCurrentLevelSlots` writes a username string.
 * - `index`, `length` and `originalIndex` are optional because only some
 *   producers set them. `updateCurrentLevelSlots` writes `index`/`length`;
 *   the slots that arrive in the game-initialization payload may not carry
 *   them, and nothing reads them back off a slot today.
 *
 * Anything arriving from the database or an HTTP request is **not** a `Slot`
 * until it has been validated — `src/lib/board-utils.ts` deliberately takes
 * `unknown` for exactly that reason, and should keep doing so.
 */
export interface Slot {
  letters: string[];
  word: string;
  user?: string | null;
  hitMax: boolean;
  originalIndex?: number;
  index?: number;
  length?: number;
}
