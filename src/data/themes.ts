/**
 * The UI themes a visitor can pick in the player/streamer settings dialog.
 *
 * One list feeds both the `<select>` in ThemeControl.astro and the
 * before-first-paint script in WosBaseLayout.astro, so adding a theme here is
 * all it takes for it to be offered and accepted. Each id is applied as
 * `data-theme="<id>"` on the document root; the matching stylesheet is
 * `src/styles/wos-theme-<id>.css` (the "default" theme has none — it is the
 * base styling).
 */

export interface Theme {
  /** Value stored in localStorage and set as `data-theme` on `<html>`. */
  id: string;
  /** Name shown in the settings dialog. */
  label: string;
  /**
   * Sound played when a level is passed, in place of the usual clear /
   * near-miss / decent-effort sounds (specs/game-flow.md). Omit to keep them.
   */
  levelPassSound?: string;
}

export const THEMES = [
  { id: 'default', label: 'Default' },
  { id: 'sticker-pop', label: 'Sticker Pop' },
  { id: 'halloween', label: 'Halloween' },
  { id: 'thanksgiving', label: 'Thanksgiving', levelPassSound: '/assets/gobble.wav' },
] as const satisfies readonly Theme[];

export type ThemeId = (typeof THEMES)[number]['id'];

export const THEME_IDS: readonly ThemeId[] = THEMES.map((t) => t.id);

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

/**
 * The theme a view should show: a stored, known choice wins; otherwise the
 * view's own default; otherwise "default".
 */
export function resolveTheme(stored: string | null | undefined, viewDefault: string): ThemeId {
  if (isThemeId(stored)) return stored;
  return isThemeId(viewDefault) ? viewDefault : 'default';
}

/**
 * The sound a theme plays for a passed level, or undefined when the theme (or
 * an unknown value) keeps the usual sounds. Takes the raw `data-theme` value.
 */
export function levelPassSoundFor(theme: string | null | undefined): string | undefined {
  const match = (THEMES as readonly Theme[]).find((t) => t.id === theme);
  return match?.levelPassSound;
}
