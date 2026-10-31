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

for (const [path, defaultTheme] of [
  ['/player', 'sticker-pop'],
  ['/streamer', 'default'],
] as const) {
  test(`${path} offers the Halloween theme and keeps it after a reload`, async ({ page }) => {
    await blockExternalNetwork(page);
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', defaultTheme);

    const select = page.locator('#theme-select');
    await expect(select.locator('option')).toHaveText(['Default', 'Sticker Pop', 'Halloween']);

    await select.selectOption('halloween');
    await expect(html).toHaveAttribute('data-theme', 'halloween');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(html).toHaveAttribute('data-theme', 'halloween');
    await expect(select).toHaveValue('halloween');
  });
}
