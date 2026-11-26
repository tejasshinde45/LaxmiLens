import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';

const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';
const TEST_USER_EMAIL = 'e2e-backup@example.com';
const BACKUP_PASSPHRASE = 'E2EBackupVault#2026!';
const SAFETY_PASSPHRASE = 'E2ESafetyVault#2026!';

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

async function setupMockSupabaseAuthAndTrackSync(page: Page) {
  const cloudSyncRequests: string[] = [];
  const fakeUser = {
    id: TEST_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: TEST_USER_EMAIL,
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    user_metadata: { full_name: 'E2E Backup User' },
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
    cloudSyncRequests.push(`${route.request().method()} ${route.request().url()}`);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  return { cloudSyncRequests };
}

test.describe('Phase 11 Stage 3 Browser E2E: Encrypted Backup & IndexedDB Restore', () => {
  test('exports encrypted backup, restores over fresh seeded defaults, preserves data across reload, enforces Replace + safety backup, and triggers zero auto-sync', async ({
    page
  }, testInfo) => {
    const { cloudSyncRequests } = await setupMockSupabaseAuthAndTrackSync(page);

    // 1. Authenticate via UI -> opens user-scoped browser IndexedDB (Dexie v8)
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email Address' }).fill(TEST_USER_EMAIL);
    await page.getByRole('textbox', { name: 'Password' }).fill('ValidPass123!');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // Visit Transactions once so default categories are seeded natively in IndexedDB
    await page.goto('/transactions');
    await expect(page).toHaveURL(/\/transactions/);

    // 2. Register a real financial account in IndexedDB
    await page.goto('/accounts');
    await page.getByRole('button', { name: 'New Account' }).click();
    await page.getByLabel('Account Name').fill('E2E Obsidian Checking');
    await page.getByLabel('Opening Balance (INR)').fill('2500');
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByText('E2E Obsidian Checking')).toBeVisible({ timeout: 10000 });

    // 3. Create & download encrypted backup from SettingsPage
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Data Backup & Restore' })).toBeVisible();

    await page.getByRole('textbox', { name: 'Encryption Passphrase' }).fill(BACKUP_PASSPHRASE);
    await page.getByRole('textbox', { name: 'Confirm Passphrase' }).fill(BACKUP_PASSPHRASE);

    const backupDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Create Backup/i }).click();
    const backupDownload = await backupDownloadPromise;

    const backupFilePath = testInfo.outputPath(backupDownload.suggestedFilename());
    await backupDownload.saveAs(backupFilePath);
    await expect(page.getByText(/Encrypted backup downloaded to your device/i)).toBeVisible();

    const rawBackupJson = await fs.readFile(backupFilePath, 'utf-8');
    expect(rawBackupJson).not.toContain('E2E Obsidian Checking');
    expect(rawBackupJson).not.toContain(TEST_USER_ID);
    const parsedEnvelope = JSON.parse(rawBackupJson);
    expect(parsedEnvelope.format).toBe('laxmilens-encrypted-backup');
    expect(parsedEnvelope.kdf.iterations).toBe(600000);

    // 4. Clear non-category user stores in real IndexedDB & seed fresh random-UUID default categories
    await page.evaluate(async (userId) => {
      const dbName = `LaxmiLens_LocalDB_${userId}`;
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const stores = Array.from(db.objectStoreNames);
          const tx = db.transaction(stores, 'readwrite');
          for (const storeName of stores) {
            if (storeName === 'categories') {
              const store = tx.objectStore(storeName);
              const clearReq = store.clear();
              clearReq.onsuccess = () => {
                store.put({
                  id: '33333333-3333-4333-8333-0000000000aa',
                  userId,
                  name: 'Groceries & Household',
                  type: 'expense',
                  isDefault: true,
                  isArchived: false,
                  version: 1,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString()
                });
              };
            } else {
              tx.objectStore(storeName).clear();
            }
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    }, TEST_USER_ID);

    await page.reload();
    await expect(page).toHaveURL(/\/settings/, { timeout: 15000 });

    // Confirm account is absent prior to empty restore
    await page.goto('/accounts');
    await expect(page.getByText('E2E Obsidian Checking')).toHaveCount(0);

    // 5. Execute Empty Restore over fresh untouched seeded defaults
    await page.goto('/settings');
    await page.locator('#backup-restore-file-input').setInputFiles(backupFilePath);
    await page.getByRole('textbox', { name: 'Backup Passphrase' }).fill(BACKUP_PASSPHRASE);
    await page.getByRole('button', { name: /Decrypt & Preview/i }).click();

    const emptyDialog = page.getByRole('dialog');
    await expect(emptyDialog).toBeVisible({ timeout: 10000 });
    await expect(emptyDialog.getByText('Account Ownership Verified')).toBeVisible();
    await expect(emptyDialog.getByText('Fresh Seeded Defaults Only')).toBeVisible();

    await emptyDialog.locator('#backup-confirm-empty-restore').check();
    await emptyDialog.getByRole('button', { name: /Restore Backup Locally/i }).click();

    await expect(
      page.getByRole('status').filter({ hasText: /Local database restored successfully/i })
    ).toBeVisible({
      timeout: 10000
    });

    // Reload browser page and verify restored records persist in real IndexedDB without auto sync
    await page.reload();
    await page.goto('/accounts');
    await expect(page.getByText('E2E Obsidian Checking')).toBeVisible({ timeout: 10000 });
    expect(cloudSyncRequests).toHaveLength(0);

    // 6. Add a second account so DB now holds newer data, then verify corrupted file rejection preserves DB
    await page.getByRole('button', { name: 'New Account' }).click();
    await page.getByLabel('Account Name').fill('Second Temp Account');
    await page.getByLabel('Opening Balance (INR)').fill('5000');
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByText('Second Temp Account')).toBeVisible({ timeout: 10000 });

    const corruptPath = testInfo.outputPath('corrupt-e2e.laxmibak');
    await fs.writeFile(corruptPath, '{"format":"bad-json"', 'utf-8');

    await page.goto('/settings');
    await page.locator('#backup-restore-file-input').setInputFiles(corruptPath);
    await page.getByRole('textbox', { name: 'Backup Passphrase' }).fill(BACKUP_PASSPHRASE);
    await page.getByRole('button', { name: /Decrypt & Preview/i }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: /not valid JSON|not a valid LaxmiLens/i })
    ).toBeVisible();

    // 7. Execute Replace workflow requiring Safety Backup download + exact 'REPLACE' confirmation
    await page.locator('#backup-restore-file-input').setInputFiles(backupFilePath);
    await page.getByRole('textbox', { name: 'Backup Passphrase' }).fill(BACKUP_PASSPHRASE);
    await page.getByRole('button', { name: /Decrypt & Preview/i }).click();

    const replaceDialog = page.getByRole('dialog');
    await expect(replaceDialog).toBeVisible({ timeout: 10000 });
    await expect(
      replaceDialog.getByText(/Replace Warning: Existing Local Data Will Be Overwritten/i)
    ).toBeVisible();
    await expect(
      replaceDialog.getByRole('button', { name: /Replace Local Data & Restore/i })
    ).toHaveCount(0);

    await replaceDialog
      .getByRole('textbox', { name: 'Safety Backup Passphrase' })
      .fill(SAFETY_PASSPHRASE);
    await replaceDialog
      .getByRole('textbox', { name: 'Confirm Safety Passphrase' })
      .fill(SAFETY_PASSPHRASE);

    const safetyDownloadPromise = page.waitForEvent('download');
    await replaceDialog.getByRole('button', { name: /Download Safety Backup/i }).click();
    await safetyDownloadPromise;

    await expect(replaceDialog.getByText('Verified Receipt Issued')).toBeVisible({ timeout: 10000 });
    await replaceDialog.getByPlaceholder('REPLACE').fill('REPLACE');
    await replaceDialog.getByRole('button', { name: /Replace Local Data & Restore/i }).click();

    await expect(
      page.getByRole('status').filter({ hasText: /Local database restored successfully/i })
    ).toBeVisible({
      timeout: 10000
    });

    // Reload browser page and verify full Replace persisted cleanly with zero automatic cloud sync
    await page.reload();
    await page.goto('/accounts');
    await expect(page.getByText('E2E Obsidian Checking')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Second Temp Account')).toHaveCount(0);
    expect(cloudSyncRequests).toHaveLength(0);
  });
});
