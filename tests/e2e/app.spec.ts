import { test, expect, type Page } from '@playwright/test';

const TEST_USER_ID = '77777777-7777-4777-8777-777777777777';
const TEST_USER_EMAIL = 'e2e-shell@example.com';

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
    user_metadata: { full_name: 'E2E Shell User' },
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

async function signInThroughLoginPage(page: Page) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('textbox', { name: 'Email Address' }).fill(TEST_USER_EMAIL);
  await page.getByRole('textbox', { name: 'Password' }).fill('ValidPass123!');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
}

test.describe('LaxmiLens PWA Application Shell', () => {
  test('redirects unauthenticated visitors from / and /dashboard to /login', async ({ page }) => {
    await setupMockSupabaseAuth(page);

    await page.goto('/');
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    await expect(page.getByText('LaxmiLens').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Overview' })).toHaveCount(0);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Overview' })).toHaveCount(0);
  });

  test('renders the Obsidian Gold shell and header after authentication', async ({ page }) => {
    await setupMockSupabaseAuth(page);
    await signInThroughLoginPage(page);

    // Visiting root '/' while authenticated resolves through ProtectedRoute to /dashboard
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();

    const viewport = page.viewportSize();
    if (viewport && viewport.width >= 1024) {
      await expect(page.locator('aside').getByText('LaxmiLens')).toBeVisible();
    } else {
      await expect(page.locator('header').getByText('LL')).toBeVisible();
    }
  });

  test('navigates between authenticated routes via navigation shell', async ({ page }) => {
    await setupMockSupabaseAuth(page);
    await signInThroughLoginPage(page);

    const viewport = page.viewportSize();
    const isDesktop = Boolean(viewport && viewport.width >= 1024);

    if (isDesktop) {
      const sidebar = page.locator('aside');

      await sidebar.getByRole('link', { name: 'Transactions' }).click();
      await expect(page).toHaveURL(/\/transactions/);

      await sidebar.getByRole('link', { name: 'Accounts' }).click();
      await expect(page).toHaveURL(/\/accounts/);

      await sidebar.getByRole('link', { name: 'Budgets' }).click();
      await expect(page).toHaveURL(/\/budgets/);
    } else {
      const mobileNav = page.getByRole('navigation', { name: 'Mobile Bottom Navigation' });

      await mobileNav.getByRole('link', { name: 'History' }).click();
      await expect(page).toHaveURL(/\/transactions/);

      await mobileNav.getByRole('link', { name: 'Accounts' }).click();
      await expect(page).toHaveURL(/\/accounts/);

      await mobileNav.getByRole('button', { name: 'More Features' }).click();
      await page.getByRole('button', { name: /Budgets/i }).click();
      await expect(page).toHaveURL(/\/budgets/);
    }
  });
});
