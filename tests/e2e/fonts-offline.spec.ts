import { test, expect, type Page } from '@playwright/test';

const TEST_USER_ID = '66666666-6666-4666-8666-666666666666';
const TEST_USER_EMAIL = 'e2e-fonts@example.com';

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
    user_metadata: { full_name: 'E2E Typography User' },
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

test.describe('Phase 12 Stage 2D: Self-Hosted Fonts & Offline Typography', () => {
  test('serves self-hosted Manrope WOFF2 fonts locally with valid MIME type and zero external font requests', async ({
    page
  }) => {
    const externalFontRequests: string[] = [];
    const localFontResponses: Array<{ url: string; status: number; contentType: string | undefined }> = [];
    const consoleErrors: string[] = [];
    const preloadWarnings: string[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (/fonts\.(googleapis|gstatic)\.com/i.test(url)) {
        externalFontRequests.push(url);
      }
    });

    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('/fonts/') && url.endsWith('.woff2')) {
        localFontResponses.push({
          url,
          status: res.status(),
          contentType: res.headers()['content-type']
        });
      }
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
      if (msg.text().includes('was preloaded using link preload but not used')) {
        preloadWarnings.push(msg.text());
      }
    });

    await setupMockSupabaseAuth(page);
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible({ timeout: 15000 });

    const initialFontState = await page.evaluate(async () => {
      await document.fonts.ready;
      const loaded = Array.from(document.fonts)
        .filter((f) => f.status === 'loaded')
        .map((f) => ({ family: f.family, weight: f.weight, status: f.status }));
      const bodyFont = getComputedStyle(document.body).fontFamily;
      const heading = document.querySelector('h1, h2');
      const headingFont = heading ? getComputedStyle(heading).fontFamily : '';
      return { loaded, bodyFont, headingFont };
    });

    expect(externalFontRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(preloadWarnings).toEqual([]);

    expect(localFontResponses.some((r) => r.url.includes('/fonts/manrope-latin-wght.woff2'))).toBe(true);
    for (const fontRes of localFontResponses) {
      expect(fontRes.status).toBe(200);
      expect(fontRes.contentType).toContain('font/woff2');
    }

    expect(initialFontState.bodyFont).toContain('Manrope');
    expect(initialFontState.headingFont).toContain('Manrope');
    expect(initialFontState.loaded.some((f) => f.family.replace(/['"]/g, '') === 'Manrope')).toBe(true);

    // Sign in so ₹ (U+20B9) financial metrics render cleanly via self-hosted Manrope latin-ext subset
    await page.getByRole('textbox', { name: 'Email Address' }).fill(TEST_USER_EMAIL);
    await page.getByRole('textbox', { name: 'Password' }).fill('ValidPass123!');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    // Wait for lazy DashboardPage chunk to mount and render ₹ financial amounts
    await expect(page.getByText('₹').first()).toBeVisible({ timeout: 15000 });

    const dashboardFontState = await page.evaluate(async () => {
      await document.fonts.ready;
      const loaded = Array.from(document.fonts)
        .filter((f) => f.status === 'loaded')
        .map((f) => ({ family: f.family, weight: f.weight }));
      const horizontalOverflow = document.documentElement.scrollWidth - window.innerWidth;
      return { loaded, horizontalOverflow };
    });

    expect(dashboardFontState.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(dashboardFontState.loaded.some((f) => f.family.replace(/['"]/g, '') === 'Manrope')).toBe(true);
    expect(
      localFontResponses.some((r) => r.url.includes('/fonts/manrope-latin-ext-wght.woff2') && r.status === 200)
    ).toBe(true);
    expect(externalFontRequests).toEqual([]);
  });

  test('precaches self-hosted WOFF2 fonts in Service Worker and renders typography offline in production preview', async ({
    page,
    context
  }) => {
    const requireSwOffline = process.env.PW_PREVIEW === '1';

    await setupMockSupabaseAuth(page);
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible({ timeout: 15000 });

    const swReady = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false, controlled: false, cachedFonts: [] as string[] };
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return { supported: true, controlled: false, cachedFonts: [] as string[] };
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        return { supported: true, controlled: false, cachedFonts: [] as string[], needsReload: true };
      }
      const cacheNames = await caches.keys();
      const matched: string[] = [];
      for (const name of cacheNames) {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        for (const r of requests) {
          if (r.url.includes('/fonts/')) matched.push(new URL(r.url).pathname);
        }
      }
      return { supported: true, controlled: true, cachedFonts: matched };
    });

    // Reload once if SW just installed on first navigation
    if (swReady.supported && 'needsReload' in swReady && swReady.needsReload) {
      await page.reload({ waitUntil: 'load' });
      await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible({ timeout: 15000 });
    }

    const postReloadSw = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { controlled: false, cachedFonts: [] as string[] };
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return { controlled: false, cachedFonts: [] as string[] };
      await navigator.serviceWorker.ready;
      const cacheNames = await caches.keys();
      const matched: string[] = [];
      for (const name of cacheNames) {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        for (const r of requests) {
          if (r.url.includes('/fonts/')) matched.push(new URL(r.url).pathname);
        }
      }
      return {
        controlled: Boolean(navigator.serviceWorker.controller),
        cachedFonts: matched.sort()
      };
    });

    if (!requireSwOffline && !postReloadSw.controlled) {
      test.info().annotations.push({
        type: 'note',
        description: 'Service Worker inactive under Vite dev server; full offline SW test runs in PW_PREVIEW=1 mode.'
      });
      return;
    }

    expect(postReloadSw.controlled).toBe(true);
    expect(postReloadSw.cachedFonts).toEqual([
      '/fonts/inter-latin-wght.woff2',
      '/fonts/manrope-latin-ext-wght.woff2',
      '/fonts/manrope-latin-wght.woff2'
    ]);

    const offlineFailedFonts: string[] = [];
    const offlineServedFonts: string[] = [];
    page.on('requestfailed', (req) => {
      if (req.url().includes('/fonts/')) {
        offlineFailedFonts.push(req.url());
      }
    });
    page.on('response', (res) => {
      if (res.url().includes('/fonts/') && res.status() === 200) {
        offlineServedFonts.push(new URL(res.url()).pathname);
      }
    });

    // Simulate full browser offline mode and reload page from Service Worker cache
    await context.setOffline(true);
    try {
      await page.reload({ waitUntil: 'load' });
      await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible({ timeout: 15000 });

      const offlineFontCheck = await page.evaluate(async () => {
        await document.fonts.ready;
        const loaded = Array.from(document.fonts)
          .filter((f) => f.status === 'loaded')
          .map((f) => f.family.replace(/['"]/g, ''));
        return {
          bodyFont: getComputedStyle(document.body).fontFamily,
          loadedFamilies: Array.from(new Set(loaded))
        };
      });

      expect(offlineFailedFonts).toEqual([]);
      expect(offlineServedFonts).toContain('/fonts/manrope-latin-wght.woff2');
      expect(offlineFontCheck.bodyFont).toContain('Manrope');
      expect(offlineFontCheck.loadedFamilies).toContain('Manrope');
    } finally {
      await context.setOffline(false);
    }
  });
});
