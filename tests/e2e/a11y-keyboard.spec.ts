import { test, expect, type Page } from '@playwright/test';

const TEST_USER_ID = '55555555-5555-4555-8555-555555555555';
const TEST_USER_EMAIL = 'e2e-a11y@example.com';

function buildFakeJwt(userId: string, email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      email,
      aud: 'authenticated',
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600
    })
  ).toString('base64url');
  return `${header}.${payload}.mock-signature`;
}

async function setupMockSupabaseAuth(page: Page) {
  const fakeUser = {
    id: TEST_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: TEST_USER_EMAIL,
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    user_metadata: { full_name: 'E2E A11y User' },
    app_metadata: { provider: 'email', providers: ['email'] },
    created_at: '2026-01-01T00:00:00.000Z'
  };

  await page.route('**/auth/v1/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/v1/token')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: buildFakeJwt(TEST_USER_ID, TEST_USER_EMAIL),
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'e2e-refresh-token',
          user: fakeUser
        })
      });
    }
    if (url.includes('/auth/v1/user')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fakeUser)
      });
    }
    if (url.includes('/auth/v1/logout')) {
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/rest/v1/**', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });
}

async function auditRouteDomA11y(page: Page, routeName: string) {
  const result = await page.evaluate(() => {
    const isVisible = (el: Element): boolean => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const h1Count = Array.from(document.querySelectorAll('h1')).filter(isVisible).length;
    const hasMain = Boolean(document.querySelector('main'));

    const unlabeledControls: string[] = [];
    const interactive = document.querySelectorAll('button, a[href], input, select, textarea');
    for (const el of Array.from(interactive)) {
      if (!isVisible(el)) continue;
      if ((el as HTMLElement).getAttribute('aria-hidden') === 'true') continue;
      if ((el as HTMLElement).getAttribute('tabindex') === '-1') continue;

      const tag = el.tagName.toLowerCase();
      const ariaLabel = el.getAttribute('aria-label')?.trim() ?? '';
      const labelledById = el.getAttribute('aria-labelledby');
      const labelledByText = labelledById
        ? labelledById
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
            .join(' ')
            .trim()
        : '';

      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        const id = el.getAttribute('id');
        const forLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim() ?? '' : '';
        const parentLabel = el.closest('label')?.textContent?.trim() ?? '';
        const name = ariaLabel || labelledByText || forLabel || parentLabel;
        if (!name) {
          unlabeledControls.push(`${tag}#${id || 'no-id'}`);
        }
      } else {
        const text = el.textContent?.trim() ?? '';
        const title = el.getAttribute('title')?.trim() ?? '';
        const name = ariaLabel || labelledByText || text || title;
        if (!name) {
          unlabeledControls.push(`${tag}.${el.className.toString().slice(0, 30)}`);
        }
      }
    }

    const thWithoutScope: string[] = [];
    for (const th of Array.from(document.querySelectorAll('th'))) {
      if (isVisible(th) && !th.getAttribute('scope')) {
        thWithoutScope.push(th.textContent?.trim() || 'empty-th');
      }
    }

    const brokenAriaRefs: string[] = [];
    for (const refAttr of ['aria-describedby', 'aria-labelledby', 'aria-controls']) {
      for (const el of Array.from(document.querySelectorAll(`[${refAttr}]`))) {
        if (!isVisible(el)) continue;
        // Closed disclosures can point aria-controls at an unmounted portal
        if (refAttr === 'aria-controls' && el.getAttribute('aria-expanded') === 'false') continue;
        const ids = (el.getAttribute(refAttr) ?? '').trim().split(/\s+/).filter(Boolean);
        for (const id of ids) {
          if (!document.getElementById(id)) {
            brokenAriaRefs.push(`${refAttr}=${id}`);
          }
        }
      }
    }

    return { h1Count, hasMain, unlabeledControls, thWithoutScope, brokenAriaRefs };
  });

  expect(result.hasMain, `${routeName}: missing <main>`).toBe(true);
  expect(result.h1Count, `${routeName}: expected single visible <h1>`).toBe(1);
  expect(result.unlabeledControls, `${routeName}: unlabeled visible controls`).toEqual([]);
  expect(result.thWithoutScope, `${routeName}: <th> missing scope`).toEqual([]);
  expect(result.brokenAriaRefs, `${routeName}: broken ARIA id references`).toEqual([]);
}

test.describe('Phase 12 Stage 3A: Keyboard & Accessibility Verification', () => {
  test('supports full keyboard workflows for login, skip link, navigation, Quick Add, and Settings backup UI', async ({
    page
  }) => {
    await setupMockSupabaseAuth(page);

    // 1. Login form keyboard workflow + accessible validation
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome Back' })).toBeVisible({
      timeout: 15000
    });
    await auditRouteDomA11y(page, '/login');

    await page.keyboard.press('Tab');
    const firstFocusedTag = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
    expect(firstFocusedTag).toBe('email');

    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByLabel('Email Address')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Email Address')).toHaveAccessibleDescription(/Email is required/i);

    // Sign in via keyboard
    await page.getByRole('textbox', { name: 'Email Address' }).fill(TEST_USER_EMAIL);
    await page.getByRole('textbox', { name: 'Password' }).fill('ValidPass123!');
    await page.getByRole('textbox', { name: 'Password' }).press('Enter');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

    // Wait for lazy overview content
    await expect(page.getByText('Net Worth')).toBeVisible({ timeout: 15000 });
    await auditRouteDomA11y(page, '/dashboard');

    const viewport = page.viewportSize();
    const isDesktop = Boolean(viewport && viewport.width >= 1024);

    if (isDesktop) {
      // Skip-to-main-content keyboard flow
      await page.locator('body').focus();
      await page.keyboard.press('Tab');
      const skipLink = page.getByRole('link', { name: 'Skip to main content' });
      await expect(skipLink).toBeFocused();
      await page.keyboard.press('Enter');
      const mainFocused = await page.evaluate(() => document.activeElement?.id === 'main-content');
      expect(mainFocused).toBe(true);

      // Sidebar collapse/expand keyboard + aria-expanded check
      const collapseBtn = page.getByRole('button', { name: 'Collapse sidebar' });
      await collapseBtn.click();
      const expandBtn = page.getByRole('button', { name: 'Expand sidebar' });
      await expect(expandBtn).toHaveAttribute('aria-expanded', 'false');
      await expect(
        page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Budgets' })
      ).toBeVisible();
      await expandBtn.click();

      // Open CommandPalette with Ctrl+K -> launch Quick Add -> verify dialog focus containment + Escape
      await page.keyboard.press('Control+k');
      const cmdDialog = page.getByRole('dialog');
      await expect(cmdDialog).toBeVisible();
      await expect(
        cmdDialog.getByRole('textbox', { name: 'Search commands or destinations' })
      ).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(cmdDialog).toHaveCount(0);

      await page.keyboard.press('Control+k');
      await page.getByRole('option', { name: /Quick Add Transaction/i }).click();
    } else {
      // Mobile: verify BottomNavigation More dialog containment + Escape restoration, then open Quick Add FAB
      const moreBtn = page.getByRole('button', { name: 'More Features' });
      await moreBtn.click();
      const moreDialog = page.getByRole('dialog');
      await expect(moreDialog).toBeVisible();
      await expect(page.locator('[aria-controls="mobile-more-sheet"]')).toHaveAttribute(
        'aria-expanded',
        'true'
      );
      await page.keyboard.press('Escape');
      await expect(moreDialog).toHaveCount(0);
      await expect(moreBtn).toHaveAttribute('aria-expanded', 'false');
      await expect(moreBtn).toBeFocused();

      await page.getByRole('button', { name: 'Quick Add Transaction' }).click();
    }

    // 2. Quick Add Modal focus containment, validation wiring, and Escape closure
    const quickAddDialog = page.getByRole('dialog');
    await expect(quickAddDialog).toBeVisible();
    const initialDialogFocus = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="dialog"]'))
    );
    expect(initialDialogFocus).toBe(true);

    // Tab several times and ensure focus stays inside the modal dialog
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      const focusInsideDialog = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]'))
      );
      expect(focusInsideDialog).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(quickAddDialog).toHaveCount(0);

    // 3. Navigate across ALL authenticated routes and run automated DOM accessibility invariants
    for (const route of [
      '/transactions',
      '/accounts',
      '/borrowings',
      '/budgets',
      '/recurring',
      '/analytics',
      '/calendar',
      '/notifications',
      '/reports',
      '/settings'
    ]) {
      await page.goto(route);
      await expect(page.locator('#main-content h1').first()).toBeVisible({ timeout: 15000 });
      await auditRouteDomA11y(page, route);
    }

    // 4. Settings Backup & Restore keyboard check
    const passphraseInput = page.getByRole('textbox', { name: 'Encryption Passphrase' });
    await passphraseInput.focus();
    await expect(passphraseInput).toBeFocused();
    await passphraseInput.fill('short');
    await expect(passphraseInput).toHaveAttribute('aria-invalid', 'true');
    await expect(passphraseInput).toHaveAccessibleDescription(/at least 12 characters/i);
  });
});
