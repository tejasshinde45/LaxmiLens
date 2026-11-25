import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Database Migration & RLS Security Validation', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));

  it('contains valid version-controlled migration files', () => {
    expect(migrationFiles.length).toBeGreaterThanOrEqual(5);
    expect(migrationFiles).toContain('20260102000000_core_financial_foundation.sql');
    expect(migrationFiles).toContain('20260103000000_add_account_notes.sql');
    expect(migrationFiles).toContain('20260104000000_personal_borrowings.sql');
    expect(migrationFiles).toContain('20260105000000_budget_management.sql');
    expect(migrationFiles).toContain('20260106000000_category_identity_protection.sql');

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

  it('validates schema, RLS policies, SECURITY DEFINER hardening, and triggers in personal borrowings migration', () => {
    const migrationContent = fs.readFileSync(
      path.join(migrationsDir, '20260104000000_personal_borrowings.sql'),
      'utf-8'
    );

    // 1. Table definitions
    expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS public.lenders');
    expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS public.borrowings');
    expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS public.borrowing_repayments');

    // 2. Financial integer paise storage and check constraints
    expect(migrationContent).toContain('amount_paise BIGINT NOT NULL CHECK (amount_paise > 0)');

    // 3. Row Level Security enabled on all 3 tables
    expect(migrationContent).toContain('ALTER TABLE public.lenders ENABLE ROW LEVEL SECURITY');
    expect(migrationContent).toContain('ALTER TABLE public.borrowings ENABLE ROW LEVEL SECURITY');
    expect(migrationContent).toContain('ALTER TABLE public.borrowing_repayments ENABLE ROW LEVEL SECURITY');

    // 4. Ownership verification using auth.uid() = user_id
    expect(migrationContent).toContain('auth.uid() = user_id');

    // 5. Destructive operations restricted
    expect(migrationContent).not.toContain('FOR DELETE\n    USING (auth.uid() = user_id)');
    expect(migrationContent).not.toContain('FOR UPDATE\n    USING (auth.uid() = user_id)\n    WITH CHECK (auth.uid() = user_id)\n\nCREATE POLICY "Users can delete their own borrowing repayments"');

    // 6. Hardened SECURITY DEFINER with fixed search_path
    expect(migrationContent).toContain('SECURITY DEFINER');
    expect(migrationContent).toContain('SET search_path = pg_catalog, public');

    // 7. Referential integrity: ON DELETE RESTRICT for financial references
    expect(migrationContent).toContain('REFERENCES public.lenders(id) ON DELETE RESTRICT');
    expect(migrationContent).toContain('REFERENCES public.accounts(id) ON DELETE RESTRICT');
    expect(migrationContent).toContain('REFERENCES public.transactions(id) ON DELETE RESTRICT');
    expect(migrationContent).toContain('REFERENCES public.borrowings(id) ON DELETE RESTRICT');

    // 8. Concurrency row locking & principal validation
    expect(migrationContent).toContain('FOR UPDATE');
    expect(migrationContent).toContain('exceeds outstanding principal');
    expect(migrationContent).toContain('Repayment records are immutable');

    // 9. Least privilege role permissions
    expect(migrationContent).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.lenders TO authenticated');
    expect(migrationContent).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.borrowings TO authenticated');
    expect(migrationContent).toContain('GRANT SELECT, INSERT ON TABLE public.borrowing_repayments TO authenticated');
    expect(migrationContent).toContain('REVOKE ALL ON TABLE public.lenders FROM anon, authenticated, PUBLIC');
    expect(migrationContent).toContain('REVOKE ALL ON TABLE public.borrowings FROM anon, authenticated, PUBLIC');
    expect(migrationContent).toContain('REVOKE ALL ON TABLE public.borrowing_repayments FROM anon, PUBLIC');
    expect(migrationContent).toContain('REVOKE ALL ON TABLE public.borrowing_repayments FROM authenticated');
    expect(migrationContent).toContain('REVOKE ALL ON FUNCTION public.validate_borrowing_record() FROM PUBLIC, anon, authenticated');
    expect(migrationContent).toContain('REVOKE ALL ON FUNCTION public.protect_borrowing_linked_transactions() FROM PUBLIC, anon, authenticated');

    // 10. Timestamp conventions
    expect(migrationContent).toContain('created_at TIMESTAMPTZ NOT NULL DEFAULT now()');
    expect(migrationContent).toContain('updated_at TIMESTAMPTZ NOT NULL DEFAULT now()');
    expect(migrationContent).not.toContain("DEFAULT timezone('utc', now())");

    // 11. Irreversible settlement status
    expect(migrationContent).toContain('cannot transition back to');

    // 12. Durable system-account identity verification & authorized provisioning
    expect(migrationContent).toContain('ALTER TABLE public.accounts\n    ADD COLUMN IF NOT EXISTS system_tag VARCHAR(50)');
    expect(migrationContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_user_system_tag');
    expect(migrationContent).toContain('provision_personal_borrowings_account');
    expect(migrationContent).toContain('enforce_account_system_identity');
    expect(migrationContent).toContain('trg_enforce_account_system_identity');
    expect(migrationContent).toContain('GRANT EXECUTE ON FUNCTION public.provision_personal_borrowings_account');
    expect(migrationContent).toContain('REVOKE ALL ON FUNCTION public.enforce_account_system_identity() FROM PUBLIC, anon, authenticated');
    expect(migrationContent).toContain("expected system_tag ''personal_borrowings'' and account_type ''other''");
    expect(migrationContent).toContain("NEW.account_type <> 'other'");
    expect(migrationContent).toContain('NEW.opening_balance_paise <> 0');

    // Universal immutability of system_tag on UPDATE
    expect(migrationContent).toContain('system_tag is immutable once an account is created');

    // Concurrency serialization via transaction advisory lock
    expect(migrationContent).toContain('pg_advisory_xact_lock');
    expect(migrationContent).toContain("hashtext('laxmilens_provision_personal_borrowings')::integer");

    // Native execution context validation (SECURITY INVOKER & role check)
    expect(migrationContent).toContain('SECURITY INVOKER');
    expect(migrationContent).toContain("current_user IN ('authenticated', 'anon')");

    // Elimination of custom GUC and ambiguous legacy backfill
    expect(migrationContent).not.toContain('laxmilens.authorized_system_account_provisioning');
    expect(migrationContent).not.toContain('candidate_accounts');
    expect(migrationContent).not.toContain('SET system_tag =');

    // 13. Linked transaction immutability and deletion protection
    expect(migrationContent).toContain('protect_borrowing_linked_transactions');
    expect(migrationContent).toContain('NEW.deleted_at IS DISTINCT FROM OLD.deleted_at');
    expect(migrationContent).toContain('Cannot modify deleted_at on transaction');
    expect(migrationContent).toContain('Cannot alter amount on transaction');

    // 14. Non-unique lender names
    expect(migrationContent).not.toContain('idx_lenders_user_active_name');
    expect(migrationContent).toContain('CREATE INDEX IF NOT EXISTS idx_lenders_user_name ON public.lenders(user_id, name)');
  });

  it('validates schema, partial uniqueness, RLS, and integrity triggers in budget management migration', () => {
    const migrationContent = fs.readFileSync(
      path.join(migrationsDir, '20260105000000_budget_management.sql'),
      'utf-8'
    );

    // 1. Table & financial/format constraints
    expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS public.budgets');
    expect(migrationContent).toContain('category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT');
    expect(migrationContent).toContain('CONSTRAINT budgets_limit_paise_positive CHECK (limit_paise > 0)');
    expect(migrationContent).toContain('CONSTRAINT budgets_version_positive CHECK (version >= 1)');
    expect(migrationContent).toContain("CONSTRAINT budgets_period_format CHECK (period ~ '^\\d{4}-(0[1-9]|1[0-2])$')");

    // 2. Partial active unique index permitting tombstone recreation
    expect(migrationContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_active_user_category_period');
    expect(migrationContent).toContain('ON public.budgets(user_id, category_id, period)');
    expect(migrationContent).toContain('WHERE (deleted_at IS NULL)');

    // 3. RLS policies (no SQL FOR DELETE policy; tombstone updates only)
    expect(migrationContent).toContain('ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY');
    expect(migrationContent).toContain('ON public.budgets FOR SELECT');
    expect(migrationContent).toContain('ON public.budgets FOR INSERT');
    expect(migrationContent).toContain('ON public.budgets FOR UPDATE');
    expect(migrationContent).not.toContain('ON public.budgets FOR DELETE');
    expect(migrationContent).toContain('auth.uid() = user_id');

    // 4. Least-privilege GRANT/REVOKE
    expect(migrationContent).toContain('REVOKE ALL ON TABLE public.budgets FROM anon, authenticated, PUBLIC');
    expect(migrationContent).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.budgets TO authenticated');
    expect(migrationContent).toContain('REVOKE ALL ON FUNCTION public.validate_budget_record() FROM PUBLIC, anon, authenticated');

    // 5. Hardened SECURITY DEFINER trigger, search_path & explicit postgres ownership
    expect(migrationContent).toContain('CREATE OR REPLACE FUNCTION public.validate_budget_record()');
    expect(migrationContent).toContain('SECURITY DEFINER');
    expect(migrationContent).toContain('SET search_path = pg_catalog, public');
    expect(migrationContent).toContain('ALTER FUNCTION public.validate_budget_record() OWNER TO postgres;');
    expect(migrationContent.indexOf('ALTER FUNCTION public.validate_budget_record() OWNER TO postgres;')).toBeGreaterThan(
      migrationContent.indexOf('$$;')
    );
    expect(migrationContent.indexOf('ALTER FUNCTION public.validate_budget_record() OWNER TO postgres;')).toBeLessThan(
      migrationContent.indexOf('REVOKE ALL ON FUNCTION public.validate_budget_record() FROM PUBLIC, anon, authenticated;')
    );
    expect(migrationContent).toContain("v_calling_role := current_setting('role', true)");
    expect(migrationContent).toContain("v_calling_role IN ('authenticated', 'anon')");

    // 6. Category ownership & expense type validation
    expect(migrationContent).toContain('v_category_user_id <> NEW.user_id');
    expect(migrationContent).toContain("v_category_type <> 'expense'");

    // 7. Immutability, tombstone irreversibility, and monotonic OCC version lock
    expect(migrationContent).toContain('NEW.id IS DISTINCT FROM OLD.id');
    expect(migrationContent).toContain('NEW.user_id IS DISTINCT FROM OLD.user_id');
    expect(migrationContent).toContain('NEW.category_id IS DISTINCT FROM OLD.category_id');
    expect(migrationContent).toContain('NEW.period IS DISTINCT FROM OLD.period');
    expect(migrationContent).toContain('NEW.created_at IS DISTINCT FROM OLD.created_at');
    expect(migrationContent).toContain('Illegal reactivation: Tombstoned budget % cannot be reactivated.');
    expect(migrationContent).toContain('IF NEW.version <> OLD.version + 1 THEN');
    expect(migrationContent).toContain('IF NEW.deleted_at IS NOT NULL AND NEW.limit_paise <> OLD.limit_paise THEN');
  });

  it('validates category identity and type immutability protection migration', () => {
    const migrationPath = path.join(migrationsDir, '20260106000000_category_identity_protection.sql');
    expect(fs.existsSync(migrationPath)).toBe(true);

    const migrationContent = fs.readFileSync(migrationPath, 'utf-8');

    // 1. Function security attributes & explicit ownership
    expect(migrationContent).toContain('CREATE OR REPLACE FUNCTION public.protect_category_identity_and_type()');
    expect(migrationContent).toContain('SECURITY DEFINER');
    expect(migrationContent).toContain('SET search_path = pg_catalog, public');
    expect(migrationContent).toContain('ALTER FUNCTION public.protect_category_identity_and_type() OWNER TO postgres;');

    // 2. Protects id, user_id, and type with IS DISTINCT FROM and SQLSTATE 23514
    expect(migrationContent).toContain('IF NEW.id IS DISTINCT FROM OLD.id THEN');
    expect(migrationContent).toContain('IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN');
    expect(migrationContent).toContain('IF NEW.type IS DISTINCT FROM OLD.type THEN');
    expect(migrationContent).toContain("USING ERRCODE = '23514'");

    // 3. Does not prohibit archiving (is_archived updates remain permitted)
    expect(migrationContent).not.toContain('NEW.is_archived');
    expect(migrationContent).not.toContain('OLD.is_archived');

    // 4. Rerunnable trigger attachment on BEFORE UPDATE FOR EACH ROW
    expect(migrationContent).toContain('DROP TRIGGER IF EXISTS trg_protect_category_identity_and_type ON public.categories;');
    expect(migrationContent).toContain('CREATE TRIGGER trg_protect_category_identity_and_type');
    expect(migrationContent).toContain('BEFORE UPDATE ON public.categories');
    expect(migrationContent).toContain('FOR EACH ROW');
    expect(migrationContent).toContain('EXECUTE FUNCTION public.protect_category_identity_and_type();');

    // 5. Execution privilege revocation
    expect(migrationContent).toContain(
      'REVOKE ALL ON FUNCTION public.protect_category_identity_and_type() FROM PUBLIC, anon, authenticated;'
    );
  });

  it('validates Phase 8 recurring transactions & occurrences SQL migration security and idempotency', () => {
    const migrationPath = path.join(migrationsDir, '20260107000000_recurring_transactions.sql');
    expect(fs.existsSync(migrationPath)).toBe(true);

    const migrationContent = fs.readFileSync(migrationPath, 'utf-8');

    expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS public.recurring_rules');
    expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS public.recurring_occurrences');
    expect(migrationContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_occurrences_active_slot');
    expect(migrationContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_occurrences_active_transaction');
    expect(migrationContent).toContain('ALTER TABLE public.recurring_rules ENABLE ROW LEVEL SECURITY');
    expect(migrationContent).toContain('ALTER TABLE public.recurring_occurrences ENABLE ROW LEVEL SECURITY');
    expect(migrationContent).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.recurring_rules TO authenticated');
    expect(migrationContent).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.recurring_occurrences TO authenticated');
    expect(migrationContent).toContain('ALTER FUNCTION public.validate_recurring_rule_record() OWNER TO postgres;');
    expect(migrationContent).toContain('ALTER FUNCTION public.validate_recurring_occurrence_record() OWNER TO postgres;');
    expect(migrationContent).toContain('SET search_path = pg_catalog, public');
    expect(migrationContent).toContain('confirmed occurrence cannot change status');
  });

  it('validates that all RAISE statements across all migrations have matching format placeholder and argument counts', () => {
    for (const file of migrationFiles) {
      const content = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      const raiseRegex = /RAISE\s+(?:EXCEPTION|WARNING|NOTICE|INFO|LOG)\s+([^;]+);/gis;
      let match;
      while ((match = raiseRegex.exec(content)) !== null) {
        const stmt = match[1];
        const strMatch = /'((?:''|[^'])*)'/s.exec(stmt);
        if (!strMatch) continue;
        const formatStr = strMatch[1];
        const cleanFmt = formatStr.replace(/%%/g, '');
        const placeholderCount = (cleanFmt.match(/%/g) || []).length;

        let afterStr = stmt.slice(strMatch.index + strMatch[0].length);
        const usingIndex = afterStr.search(/\bUSING\b/i);
        if (usingIndex !== -1) {
          afterStr = afterStr.slice(0, usingIndex);
        }
        afterStr = afterStr.trim();
        if (afterStr.startsWith(',')) {
          afterStr = afterStr.slice(1).trim();
        }

        let argCount = 0;
        if (afterStr.length > 0) {
          let depth = 0;
          let count = 1;
          for (const ch of afterStr) {
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
            else if (ch === ',' && depth === 0) count++;
          }
          argCount = count;
        }

        expect(
          argCount,
          `Placeholder count mismatch in ${file} for statement: RAISE ${stmt.trim()}`
        ).toBe(placeholderCount);
      }
    }
  });
});
