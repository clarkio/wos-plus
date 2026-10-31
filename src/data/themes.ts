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
}

export const THEMES = [
  { id: 'default', label: 'Default' },
  { id: 'sticker-pop', label: 'Sticker Pop' },
  { id: 'halloween', label: 'Halloween' },
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
