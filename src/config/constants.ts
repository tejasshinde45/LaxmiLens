export const APP_CONFIG = {
  name: 'LaxmiLens',
  version: '0.1.0',
  defaultCurrency: 'INR',
  currencySymbol: '₹',
  subunitFactor: 100, // 1 Rupee = 100 Paise
  pagination: {
    defaultPageSize: 50,
    maxPageSize: 200
  },
  sync: {
    outboxFlushIntervalMs: 15_000,
    maxRetries: 5,
    initialRetryDelayMs: 1_000,
    maxRetryDelayMs: 60_000,
    syncLockTimeoutMs: 30_000
  },
  database: {
    name: 'LaxmiLens_LocalDB',
    version: 1
  }
} as const;
