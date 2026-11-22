import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Database Migration & RLS Security Validation', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));

  it('contains valid version-controlled migration files', () => {
    expect(migrationFiles.length).toBeGreaterThanOrEqual(2);
    expect(migrationFiles).toContain('20260102000000_core_financial_foundation.sql');
    expect(migrationFiles).toContain('20260103000000_add_account_notes.sql');

    // Verify archived prototype migration is preserved
    const archiveDir = path.resolve(__dirname, '../../../supabase/archive');
    const archiveFiles = fs.readdirSync(archiveDir).filter((f) => f.endsWith('.sql'));
    expect(archiveFiles).toContain('20260101000000_initial_schema.sql');
  });

  it('validates schema, RLS policies, and ownership triggers in core financial migration', () => {
    const migrationContent = fs.readFileSync(
      path.join(migrationsDir, '20260102000000_core_financial_foundation.sql'),
      'utf-8'
    );

    // 1. Table definitions
    expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS public.profiles');
    expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS public.accounts');
    expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS public.categories');
    expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS public.transactions');

    // 2. Financial integer paise storage and check constraints
    expect(migrationContent).toContain('amount_paise BIGINT NOT NULL CHECK (amount_paise > 0)');
    expect(migrationContent).toContain('opening_balance_paise BIGINT NOT NULL DEFAULT 0');

    // 3. Row Level Security enabled on all tables
    expect(migrationContent).toContain('ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY');
    expect(migrationContent).toContain('ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY');
    expect(migrationContent).toContain('ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY');
    expect(migrationContent).toContain('ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY');

    // 4. Ownership verification using auth.uid()
    expect(migrationContent).toContain('auth.uid() = id');
    expect(migrationContent).toContain('auth.uid() = user_id');

    // 5. Cross-tenant isolation trigger
    expect(migrationContent).toContain('validate_transaction_ownership');
    expect(migrationContent).toContain('Source account does not belong to the user');
    expect(migrationContent).toContain('Destination account does not belong to the user');
    expect(migrationContent).toContain('Category does not belong to the user');

    // 6. Atomic transfer operation RPC
    expect(migrationContent).toContain('record_transfer_atomic');
    expect(migrationContent).toContain('SECURITY DEFINER');

    // 7. Automatic category seeding
    expect(migrationContent).toContain('seed_default_categories_for_user');
    expect(migrationContent).toContain('Groceries & Household');
    expect(migrationContent).toContain('Salary & Wages');

    // 8. Soft deletion and idempotency constraints
    expect(migrationContent).toContain('deleted_at TIMESTAMPTZ');
    expect(migrationContent).toContain('unique_user_idempotency_key UNIQUE (user_id, idempotency_key)');
  });
});
