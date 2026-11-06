import { test, expect } from '@playwright/test';
import { blockExternalNetwork } from './e2e-harness';

/**
 * The settings dialog's theme picker (src/components/ThemeControl.astro).
 *
 * Unit tests pin the theme list (tests/unit/themes.test.ts); this checks what
 * only a real page can: that the rendered `<select>` offers every theme, that
 * picking one applies it to `<html data-theme>` straight away, and that the
 * first-paint script in WosBaseLayout restores it after a reload.
 */

const SEASONAL_THEMES = [
  ['halloween', 'Halloween'],
  ['thanksgiving', 'Thanksgiving'],
] as const;

for (const [path, defaultTheme] of [
  ['/player', 'sticker-pop'],
  ['/streamer', 'default'],
] as const) {
  for (const [themeId, themeLabel] of SEASONAL_THEMES) {
    test(`${path} offers the ${themeLabel} theme and keeps it after a reload`, async ({ page }) => {
      await blockExternalNetwork(page);
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      const html = page.locator('html');
      await expect(html).toHaveAttribute('data-theme', defaultTheme);

      const select = page.locator('#theme-select');
      await expect(select.locator('option')).toHaveText(['Default', 'Sticker Pop', 'Halloween', 'Thanksgiving']);

      await select.selectOption(themeId);
      await expect(html).toHaveAttribute('data-theme', themeId);

      // Record the theme the head script set, before ThemeControl's own
      // DOMContentLoaded handler can re-apply it, so a regression in the
      // first-paint script can't hide behind the picker.
      await page.addInitScript(() => {
        document.addEventListener(
          'DOMContentLoaded',
          () => {
            document.documentElement.setAttribute(
              'data-first-paint-theme',
              document.documentElement.dataset.theme ?? '',
            );
          },
          { capture: true, once: true },
        );
      });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(html).toHaveAttribute('data-first-paint-theme', themeId);
      await expect(html).toHaveAttribute('data-theme', themeId);
      await expect(select).toHaveValue(themeId);
    });
  }
}
