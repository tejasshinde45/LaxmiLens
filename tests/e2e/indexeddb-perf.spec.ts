import { test, expect, type Page } from '@playwright/test';

const PERF_USER_ID = '99999999-9999-4999-8999-999999999999';
const OTHER_USER_ID = '88888888-8888-4888-8888-888888888888';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const TEST_USER_EMAIL = 'e2e-perf@example.com';

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
  const cloudSyncRequests: string[] = [];
  const fakeUser = {
    id: PERF_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: TEST_USER_EMAIL,
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    user_metadata: { full_name: 'E2E Perf User' },
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
          access_token: buildFakeJwt(PERF_USER_ID, TEST_USER_EMAIL),
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

test.describe('Phase 12 Stage 2B Chromium IndexedDB Verification & Benchmark', () => {
  test('verifies real Dexie v4 + Chromium IndexedDB index usage, query counts, and dashboard integrity', async ({
    page
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const { cloudSyncRequests } = await setupMockSupabaseAuth(page);

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email Address' }).fill(TEST_USER_EMAIL);
    await page.getByRole('textbox', { name: 'Password' }).fill('ValidPass123!');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    const benchmarkResult = await page.evaluate(
      async ({ userId, otherUserId, nilUuid }) => {
        const importMod = (p: string) => import(/* @vite-ignore */ p);

        const [
          { LaxmiLensDB },
          { DexieAccountRepository },
          { DexieTransactionRepository },
          { DexieCategoryRepository },
          { DexieBudgetRepository },
          { GetAccountsWithBalanceUseCase },
          { GetBudgetsOverviewUseCase },
          { DateRange },
          { Account },
          { Transaction },
          { Category },
          { Budget },
          { createAccountId, createBudgetId, createCategoryId, createTransactionId }
        ] = await Promise.all([
          importMod('/src/infrastructure/database/local/DexieDatabase.ts'),
          importMod('/src/infrastructure/database/local/repositories/DexieAccountRepository.ts'),
          importMod('/src/infrastructure/database/local/repositories/DexieTransactionRepository.ts'),
          importMod('/src/infrastructure/database/local/repositories/DexieCategoryRepository.ts'),
          importMod('/src/infrastructure/database/local/repositories/DexieBudgetRepository.ts'),
          importMod('/src/application/use-cases/accounts/GetAccountsWithBalanceUseCase.ts'),
          importMod('/src/application/use-cases/budgets/GetBudgetsOverviewUseCase.ts'),
          importMod('/src/domain/value-objects/DateRange.ts'),
          importMod('/src/domain/entities/Account.ts'),
          importMod('/src/domain/entities/Transaction.ts'),
          importMod('/src/domain/entities/Category.ts'),
          importMod('/src/domain/entities/Budget.ts'),
          importMod('/src/domain/value-objects/Identifiers.ts')
        ]);

        const benchDbName = `LaxmiLens_Stage2B_Bench_${Date.now()}`;
        const db = new LaxmiLensDB(benchDbName);

        interface DbCoreEvent {
          table: string;
          op: 'query' | 'openCursor' | 'count' | 'get';
          indexName: string | null;
          resultCount: number;
        }
        const events: DbCoreEvent[] = [];

        db.use({
          stack: 'dbcore',
          name: 'Stage2BQueryProfiler',
          create(downlevelDatabase: any) {
            return {
              ...downlevelDatabase,
              table(tableName: string) {
                const down = downlevelDatabase.table(tableName);
                return {
                  ...down,
                  async query(req: any) {
                    const res = await down.query(req);
                    events.push({
                      table: tableName,
                      op: 'query',
                      indexName: req.query?.index?.name ?? null,
                      resultCount: Array.isArray(res?.result) ? res.result.length : 0
                    });
                    return res;
                  },
                  async openCursor(req: any) {
                    const cursor = await down.openCursor(req);
                    events.push({
                      table: tableName,
                      op: 'openCursor',
                      indexName: req.query?.index?.name ?? null,
                      resultCount: 0
                    });
                    return cursor;
                  },
                  async count(req: any) {
                    const cnt = await down.count(req);
                    events.push({
                      table: tableName,
                      op: 'count',
                      indexName: req.query?.index?.name ?? null,
                      resultCount: Number(cnt ?? 0)
                    });
                    return cnt;
                  },
                  async get(req: any) {
                    const res = await down.get(req);
                    events.push({
                      table: tableName,
                      op: 'get',
                      indexName: null,
                      resultCount: res ? 1 : 0
                    });
                    return res;
                  }
                };
              }
            };
          }
        });

        await db.open();

        try {
          const accountRepo = new DexieAccountRepository(db);
          const transactionRepo = new DexieTransactionRepository(db);
          const categoryRepo = new DexieCategoryRepository(db);
          const budgetRepo = new DexieBudgetRepository(db);

          // 1. Seed 10 accounts
          const accounts = Array.from({ length: 10 }, (_, idx) => {
            const accId = createAccountId(
              `aaaa0000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`
            );
            return new Account({
              id: accId,
              userId,
              name: idx === 9 ? 'Archived Savings' : `Account ${idx + 1}`,
              accountType: idx === 2 ? 'credit_card' : 'bank',
              openingBalancePaise: idx === 2 ? -50000 : 100000 * (idx + 1),
              currency: 'INR',
              isArchived: idx === 9
            });
          });
          await accountRepo.saveBatch(accounts);

          // 2. Seed categories (user defaults, NIL_UUID default, custom, archived, foreign)
          const catFood = createCategoryId('cccc0000-0000-4000-8000-000000000001');
          const catArchived = createCategoryId('cccc0000-0000-4000-8000-000000000002');
          await categoryRepo.saveBatch([
            new Category({
              id: catFood,
              userId,
              name: 'Groceries',
              type: 'expense',
              isDefault: true
            }),
            new Category({
              id: catArchived,
              userId,
              name: 'Old Club',
              type: 'expense',
              isDefault: false,
              isArchived: true
            })
          ]);
          await db.categories.put({
            id: 'cccc0000-0000-4000-8000-000000000003',
            userId: nilUuid,
            name: 'Legacy Utilities',
            type: 'expense',
            isDefault: true,
            isSystem: true,
            isArchived: false,
            version: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          });
          await db.categories.put({
            id: 'cccc0000-0000-4000-8000-000000000099',
            userId: otherUserId,
            name: 'Foreign Secret Cat',
            type: 'expense',
            isDefault: false,
            isArchived: false,
            version: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          });

          // 3. Seed 1,200 transactions across 24 months (50/month)
          const txs = [];
          for (let m = 0; m < 24; m++) {
            const yr = 2025 + Math.floor(m / 12);
            const mo = (m % 12) + 1;
            for (let d = 1; d <= 25; d++) {
              const dt = new Date(Date.UTC(yr, mo - 1, d, 12, 0, 0));
              const accIdx = (m + d) % 10;
              txs.push(
                new Transaction({
                  id: createTransactionId(
                    `bbbb0000-0000-4000-8000-${String(txs.length + 1).padStart(12, '0')}`
                  ),
                  userId,
                  type: d % 5 === 0 ? 'income' : 'expense',
                  amountPaise: 15000 + d * 100,
                  currency: 'INR',
                  accountId: accounts[accIdx].id,
                  categoryId: catFood,
                  title: `Tx ${yr}-${mo}-${d}`,
                  transactionDate: dt,
                  idempotencyKey: `bench-${txs.length + 1}`
                })
              );
              // Add transfers every 10th tx
              if (d === 15) {
                txs.push(
                  new Transaction({
                    id: createTransactionId(
                      `bbbb0000-0000-4000-8000-${String(txs.length + 1).padStart(12, '0')}`
                    ),
                    userId,
                    type: 'transfer',
                    amountPaise: 50000,
                    currency: 'INR',
                    accountId: accounts[0].id,
                    destinationAccountId: accounts[1].id,
                    title: `Transfer ${yr}-${mo}`,
                    transactionDate: dt,
                    idempotencyKey: `bench-${txs.length + 1}`
                  })
                );
              }
            }
          }
          // Add extra non-transfer to total >= 1200 cleanly
          while (txs.length < 1200) {
            const n = txs.length + 1;
            txs.push(
              new Transaction({
                id: createTransactionId(
                  `bbbb0000-0000-4000-8000-${String(n).padStart(12, '0')}`
                ),
                userId,
                type: 'expense',
                amountPaise: 10000,
                currency: 'INR',
                accountId: accounts[0].id,
                categoryId: catFood,
                title: `Extra ${n}`,
                transactionDate: new Date(Date.UTC(2025, 0, 1, 10, 0, n % 60)),
                idempotencyKey: `bench-${n}`
              })
            );
          }
          await transactionRepo.saveBatch(txs);

          // Warmup JIT & IDB pools before timed runs
          const getAccountsUseCase = new GetAccountsWithBalanceUseCase(accountRepo, transactionRepo);
          await getAccountsUseCase.execute(userId, true);

          // A. Measure Account Balances: Sequential baseline (1 + 2N) vs Optimized (2 queries)
          const ITERATIONS = 3;
          let seqTotalMs = 0;
          let optTotalMs = 0;
          let seqEvents: DbCoreEvent[] = [];
          let optAccEvents: DbCoreEvent[] = [];
          let optBalances: any[] = [];

          for (let i = 0; i < ITERATIONS; i++) {
            events.length = 0;
            const t0Seq = performance.now();
            const seqAccounts = await accountRepo.findByUserId(userId);
            for (const a of seqAccounts) {
              await transactionRepo.findByAccount(a.id, userId);
            }
            seqTotalMs += performance.now() - t0Seq;
            if (i === ITERATIONS - 1) seqEvents = events.slice();

            events.length = 0;
            const t0Opt = performance.now();
            optBalances = await getAccountsUseCase.execute(userId, true);
            optTotalMs += performance.now() - t0Opt;
            if (i === ITERATIONS - 1) optAccEvents = events.slice();
          }

          // B. Measure Date-Bounded Transaction Query: Full userId scan vs [userId+transactionDate]
          const juneRange = new DateRange(
            new Date('2026-06-01T00:00:00.000Z'),
            new Date('2026-06-30T23:59:59.999Z')
          );

          let fullTxTotalMs = 0;
          let idxTxTotalMs = 0;
          let fullTxEvents: DbCoreEvent[] = [];
          let idxTxEvents: DbCoreEvent[] = [];
          let fullFilteredInJs: any[] = [];
          let indexedJuneTx: any[] = [];

          for (let i = 0; i < ITERATIONS; i++) {
            events.length = 0;
            const t0FullTx = performance.now();
            const fullScanAll = await transactionRepo.findMany({
              userId,
              includeDeleted: false
            });
            fullFilteredInJs = fullScanAll.filter(
              (t: any) => juneRange.contains(t.transactionDate) && t.type === 'expense'
            );
            fullTxTotalMs += performance.now() - t0FullTx;
            if (i === ITERATIONS - 1) fullTxEvents = events.slice();

            events.length = 0;
            const t0IdxTx = performance.now();
            indexedJuneTx = await transactionRepo.findMany({
              userId,
              dateRange: juneRange,
              types: ['expense'],
              includeDeleted: false
            });
            idxTxTotalMs += performance.now() - t0IdxTx;
            if (i === ITERATIONS - 1) idxTxEvents = events.slice();
          }

          // C. Measure Category findByUserId in real Dexie
          events.length = 0;
          const cats = await categoryRepo.findByUserId(userId);
          const catEvents = events.slice();

          // D. Measure GetBudgetsOverviewUseCase empty short-circuit vs active
          events.length = 0;
          const budgetOverviewUseCase = new GetBudgetsOverviewUseCase(
            budgetRepo,
            transactionRepo,
            categoryRepo
          );
          const emptyBudgetRes = await budgetOverviewUseCase.execute(userId, '2026-01');
          const emptyBudgetEvents = events.slice();

          await budgetRepo.save(
            new Budget({
              id: createBudgetId('eeee0000-0000-4000-8000-000000000001'),
              userId,
              categoryId: catFood,
              period: '2026-06',
              limitPaise: 500000
            })
          );
          events.length = 0;
          const activeBudgetRes = await budgetOverviewUseCase.execute(userId, '2026-06');
          const activeBudgetEvents = events.slice();

          return {
            seqAccountsQueryCount: seqEvents.length,
            seqAccountsAvgMs: Number((seqTotalMs / ITERATIONS).toFixed(2)),
            optAccountsQueryCount: optAccEvents.length,
            optAccountsAvgMs: Number((optTotalMs / ITERATIONS).toFixed(2)),
            optAccountCount: optBalances.length,

            fullTxQueryEvents: fullTxEvents,
            fullTxAvgMs: Number((fullTxTotalMs / ITERATIONS).toFixed(2)),
            fullTxCountMatch: fullFilteredInJs.length,

            idxTxQueryEvents: idxTxEvents,
            idxTxAvgMs: Number((idxTxTotalMs / ITERATIONS).toFixed(2)),
            idxTxCount: indexedJuneTx.length,

            categoryEvents: catEvents,
            categoryIds: cats.map((c: any) => c.id),

            emptyBudgetEvents,
            emptyBudgetCount: emptyBudgetRes.summary.budgetCount,
            activeBudgetEvents,
            activeBudgetSpentPaise: activeBudgetRes.summary.totalSpentPaise
          };
        } finally {
          db.close();
          await LaxmiLensDB.delete(benchDbName);
        }
      },
      { userId: PERF_USER_ID, otherUserId: OTHER_USER_ID, nilUuid: NIL_UUID }
    );

    // Log genuine Chromium measurements for inspection
    console.log('Stage 2B Real Chromium IndexedDB Benchmark:', JSON.stringify(benchmarkResult, null, 2));

    // Assertions against real Chromium Dexie behavior:
    expect(pageErrors).toEqual([]);
    expect(cloudSyncRequests).toEqual([]);

    // 1. Account balances: 21 sequential DBCore queries -> 2 DBCore queries
    expect(benchmarkResult.seqAccountsQueryCount).toBe(21);
    expect(benchmarkResult.optAccountsQueryCount).toBe(2);
    expect(benchmarkResult.optAccountCount).toBe(10);

    // 2. Bounded transactions query uses [userId+transactionDate] index and scans only June rows
    expect(benchmarkResult.idxTxQueryEvents).toHaveLength(1);
    expect(benchmarkResult.idxTxQueryEvents[0].indexName).toBe('[userId+transactionDate]');
    expect(benchmarkResult.idxTxQueryEvents[0].resultCount).toBeLessThan(100);
    expect(benchmarkResult.fullTxQueryEvents[0].resultCount).toBeGreaterThanOrEqual(1200);
    expect(benchmarkResult.idxTxCount).toBe(benchmarkResult.fullTxCountMatch);

    // 3. Categories uses single indexed userId operation (zero unindexed full-table scans!)
    expect(benchmarkResult.categoryEvents).toHaveLength(1);
    expect(benchmarkResult.categoryEvents[0].indexName).toBe('userId');
    expect(['query', 'openCursor']).toContain(benchmarkResult.categoryEvents[0].op);
    expect(benchmarkResult.categoryIds).toContain('cccc0000-0000-4000-8000-000000000001');
    expect(benchmarkResult.categoryIds).toContain('cccc0000-0000-4000-8000-000000000002');
    expect(benchmarkResult.categoryIds).toContain('cccc0000-0000-4000-8000-000000000003');
    expect(benchmarkResult.categoryIds).not.toContain('cccc0000-0000-4000-8000-000000000099');

    // 4. Budget overview short-circuits empty periods (1 query) and uses bounded date query when budgets exist
    expect(benchmarkResult.emptyBudgetEvents).toHaveLength(1);
    expect(benchmarkResult.emptyBudgetCount).toBe(0);
    expect(
      benchmarkResult.activeBudgetEvents.some(
        (e) => e.table === 'transactions' && e.indexName === '[userId+transactionDate]'
      )
    ).toBe(true);
    expect(benchmarkResult.activeBudgetSpentPaise).toBeGreaterThan(0);
  });
});
