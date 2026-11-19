import { test, expect } from '@playwright/test';

test.describe('LaxmiLens PWA Application Shell', () => {
  test('should render the Obsidian Gold shell and header', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=LaxmiLens')).toBeVisible();
    await expect(page.locator('text=Dashboard')).toBeVisible();
  });
});
