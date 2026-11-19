import { test, expect } from '@playwright/test';

test.describe('LaxmiLens PWA Application Shell', () => {
  test('should render the Obsidian Gold shell and header', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=LaxmiLens').first()).toBeVisible();
    await expect(page.locator('text=Overview').first()).toBeVisible();
  });

  test('should navigate between routes via sidebar', async ({ page }) => {
    await page.goto('/dashboard');

    // Click Transactions
    await page.click('text=Transactions');
    await expect(page).toHaveURL(/.*transactions/);

    // Click Accounts
    await page.click('text=Accounts');
    await expect(page).toHaveURL(/.*accounts/);

    // Click Budgets
    await page.click('text=Budgets');
    await expect(page).toHaveURL(/.*budgets/);
  });
});
