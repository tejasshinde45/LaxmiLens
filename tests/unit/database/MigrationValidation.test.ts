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
    expect(migrationFiles).toContain('20260107000000_recurring_transactions.sql');
    expect(migrationFiles).toContain('20260108000000_notifications.sql');

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

    // 1. Tables, constraints, and non-partial FK indexes
    expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS public.recurring_rules');
    expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS public.recurring_occurrences');
    expect(migrationContent).toContain('CONSTRAINT recurring_rules_title_not_empty CHECK (length(trim(title)) > 0)');
    expect(migrationContent).toContain('CONSTRAINT recurring_rules_confirmation_required CHECK (requires_user_confirmation = true)');
    expect(migrationContent).toContain('AND next_due_date >= start_date');
    expect(migrationContent).toContain('CONSTRAINT recurring_occurrences_idempotency_key_not_empty CHECK (length(trim(idempotency_key)) > 0)');
    expect(migrationContent).toContain('CONSTRAINT recurring_occurrences_tx_status_consistency');
    expect(migrationContent).toContain('CONSTRAINT recurring_occurrences_snooze_status_consistency');
    expect(migrationContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_occurrences_active_slot');
    expect(migrationContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_occurrences_active_transaction');
    expect(migrationContent).toContain('CREATE INDEX IF NOT EXISTS idx_recurring_rules_account_id ON public.recurring_rules(account_id);');
    expect(migrationContent).toContain('CREATE INDEX IF NOT EXISTS idx_recurring_rules_category_id ON public.recurring_rules(category_id);');
    expect(migrationContent).toContain('CREATE INDEX IF NOT EXISTS idx_recurring_occurrences_transaction_id ON public.recurring_occurrences(transaction_id);');

    // 2. RLS policies & least-privilege grants
    expect(migrationContent).toContain('ALTER TABLE public.recurring_rules ENABLE ROW LEVEL SECURITY');
    expect(migrationContent).toContain('ALTER TABLE public.recurring_occurrences ENABLE ROW LEVEL SECURITY');
    expect(migrationContent).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.recurring_rules TO authenticated');
    expect(migrationContent).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.recurring_occurrences TO authenticated');
    expect(migrationContent).not.toContain('ON public.recurring_rules FOR DELETE');
    expect(migrationContent).not.toContain('ON public.recurring_occurrences FOR DELETE');

    // 3. Hardened SECURITY DEFINER, search_path, postgres ownership & role checks
    expect(migrationContent).toContain('ALTER FUNCTION public.assert_valid_gregorian_date(TEXT, TEXT) OWNER TO postgres;');
    expect(migrationContent).toContain('ALTER FUNCTION public.validate_recurring_rule_record() OWNER TO postgres;');
    expect(migrationContent).toContain('ALTER FUNCTION public.validate_recurring_occurrence_record() OWNER TO postgres;');
    expect(migrationContent).toContain('ALTER FUNCTION public.protect_recurring_linked_transactions() OWNER TO postgres;');
    expect(migrationContent).toContain('REVOKE ALL ON FUNCTION public.assert_valid_gregorian_date(TEXT, TEXT) FROM PUBLIC, anon, authenticated;');
    expect(migrationContent).toContain('REVOKE ALL ON FUNCTION public.validate_recurring_rule_record() FROM PUBLIC, anon, authenticated;');
    expect(migrationContent).toContain('REVOKE ALL ON FUNCTION public.validate_recurring_occurrence_record() FROM PUBLIC, anon, authenticated;');
    expect(migrationContent).toContain('REVOKE ALL ON FUNCTION public.protect_recurring_linked_transactions() FROM PUBLIC, anon, authenticated;');
    expect(migrationContent).toContain('SET search_path = pg_catalog, public');
    expect(migrationContent).toContain("COALESCE(NULLIF(NULLIF(current_setting('role', true), ''), 'none'), current_user)");

    // 4. Strict Gregorian leap-year validation, version=1 init, rule completed & tombstone locking
    expect(migrationContent).toContain('(v_year % 4 = 0 AND v_year % 100 <> 0) OR (v_year % 400 = 0)');
    expect(migrationContent).toContain('version must initialize to 1 on insert');
    expect(migrationContent).toContain('Illegal modification on completed recurring rule');
    expect(migrationContent).toContain('Invalid tombstone on recurring rule %: financial and schedule fields cannot change during deletion.');

    // 5. Occurrence immutability, terminal states, tombstone lock & transaction linkage parity
    expect(migrationContent).toContain('cannot attach or update occurrence on tombstoned schedule');
    expect(migrationContent).toContain('cannot be earlier than schedule start_date');
    expect(migrationContent).toContain('Linked transaction % has been soft-deleted.');
    expect(migrationContent).toContain('Transaction type mismatch on recurring occurrence');
    expect(migrationContent).toContain('Immutability violation on confirmed recurring occurrence %: status, transaction_id, confirmed_at, skipped_at, dismissed_at, snoozed_until_date, and deleted_at are locked.');
    expect(migrationContent).toContain('NEW.skipped_at IS DISTINCT FROM OLD.skipped_at');
    expect(migrationContent).toContain('NEW.dismissed_at IS DISTINCT FROM OLD.dismissed_at');
    expect(migrationContent).toContain('terminal status % is irreversible.');
    expect(migrationContent).toContain('Illegal modification: Tombstoned recurring occurrence % cannot be altered.');

    // 6. Targeted protection on confirmed recurring linked transactions in public.transactions
    expect(migrationContent).toContain('CREATE TRIGGER trg_protect_recurring_linked_transactions');
    expect(migrationContent).toContain('BEFORE UPDATE OR DELETE ON public.transactions');
    expect(migrationContent).toContain('Cannot change amount_paise on transaction');
    expect(migrationContent).toContain('IF NEW.currency IS DISTINCT FROM OLD.currency THEN');
    expect(migrationContent).toContain('Cannot change currency on transaction');
  });

  it('validates Phase 9 notifications & preferences SQL migration security, uniqueness, and monotonicity', () => {
    const migrationPath = path.join(migrationsDir, '20260108000000_notifications.sql');
    expect(fs.existsSync(migrationPath)).toBe(true);

    const migrationContent = fs.readFileSync(migrationPath, 'utf-8');

    // 1. Both tables and uniqueness constraints exist
    expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS public.notifications');
    expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS public.notification_preferences');
    expect(migrationContent).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe_key\n    ON public.notifications(user_id, dedupe_key);'
    );
    expect(migrationContent).toContain('user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE');

    // 2. Notification alerts must not have foreign keys to financial tables
    expect(migrationContent).not.toContain('REFERENCES public.budgets');
    expect(migrationContent).not.toContain('REFERENCES public.recurring_rules');
    expect(migrationContent).not.toContain('REFERENCES public.recurring_occurrences');
    expect(migrationContent).not.toContain('REFERENCES public.transactions');

    // 3. Indexes & preference defaults
    expect(migrationContent).toContain('idx_notifications_user_status');
    expect(migrationContent).toContain('idx_notifications_user_category');
    expect(migrationContent).toContain('idx_notifications_user_trigger_date');
    expect(migrationContent).toContain('recurring_payment_enabled BOOLEAN NOT NULL DEFAULT true');
    expect(migrationContent).toContain('budget_warning_enabled BOOLEAN NOT NULL DEFAULT true');
    expect(migrationContent).toContain('budget_exceeded_enabled BOOLEAN NOT NULL DEFAULT true');
    expect(migrationContent).toContain('upcoming_lead_days INTEGER NOT NULL DEFAULT 3');
    expect(migrationContent).toContain('upcoming_lead_days >= 0 AND upcoming_lead_days <= 30');

    // 4. RLS & least-privilege grants (no DELETE policies or anonymous access)
    expect(migrationContent).toContain('ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY');
    expect(migrationContent).toContain(
      'ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY'
    );
    expect(migrationContent).not.toContain('ON public.notifications FOR DELETE');
    expect(migrationContent).not.toContain('ON public.notification_preferences FOR DELETE');
    expect(migrationContent).toContain(
      'REVOKE ALL ON TABLE public.notifications FROM anon, authenticated, PUBLIC;'
    );
    expect(migrationContent).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.notifications TO authenticated;'
    );
    expect(migrationContent).toContain(
      'REVOKE ALL ON TABLE public.notification_preferences FROM anon, authenticated, PUBLIC;'
    );
    expect(migrationContent).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.notification_preferences TO authenticated;'
    );

    // 5. Hardened SECURITY DEFINER triggers, search_path & ownership
    expect(migrationContent).toContain('CREATE OR REPLACE FUNCTION public.validate_notification_record()');
    expect(migrationContent).toContain(
      'CREATE OR REPLACE FUNCTION public.validate_notification_preference_record()'
    );
    expect(migrationContent).toContain('SET search_path = pg_catalog, public');
    expect(migrationContent).toContain(
      'ALTER FUNCTION public.validate_notification_record() OWNER TO postgres;'
    );
    expect(migrationContent).toContain(
      'ALTER FUNCTION public.validate_notification_preference_record() OWNER TO postgres;'
    );
    expect(migrationContent).toContain(
      'REVOKE ALL ON FUNCTION public.validate_notification_record() FROM PUBLIC, anon, authenticated;'
    );
    expect(migrationContent).toContain(
      'REVOKE ALL ON FUNCTION public.validate_notification_preference_record() FROM PUBLIC, anon, authenticated;'
    );

    // 6. Identity immutability, Gregorian date, metadata integer validation & monotonic rules
    expect(migrationContent).toContain("PERFORM public.assert_valid_gregorian_date(NEW.trigger_date, 'trigger_date');");
    expect(migrationContent).toContain('NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key');
    expect(migrationContent).toContain('NEW.entity_type IS DISTINCT FROM OLD.entity_type');
    expect(migrationContent).toContain('NEW.entity_id IS DISTINCT FROM OLD.entity_id');
    expect(migrationContent).toContain('NEW.action_route IS DISTINCT FROM OLD.action_route');
    expect(migrationContent).toContain('NEW.metadata_json IS DISTINCT FROM OLD.metadata_json');
    expect(migrationContent).toContain("left(action_route, 2) <> '//'");
    expect(migrationContent).toContain('position(chr(92) in action_route) = 0');
    expect(migrationContent).toContain("position('://' in action_route) = 0");
    expect(migrationContent).toContain('9007199254740991');
    expect(migrationContent).toContain('-9007199254740991');
    expect(migrationContent).toContain("OLD.category = 'budget_warning' AND NEW.category = 'budget_exceeded'");
    expect(migrationContent).toContain('Severity downgrade prohibited on notification');
    expect(migrationContent).toContain('dismissed status and timestamps are locked');
    expect(migrationContent).toContain('read status cannot revert to unread and read_at is locked');
    expect(migrationContent).toContain('IF NEW.version <> OLD.version + 1 THEN');
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
