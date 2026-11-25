-- ==============================================================================
-- Migration: 20260107000000_recurring_transactions.sql
-- Description: Hardened Recurring Transactions & Payment Reminders schema:
--              public.recurring_rules & public.recurring_occurrences tables,
--              non-partial FK indexes, partial active uniqueness preventing
--              duplicate occurrences/transactions, RLS policies, least-privilege
--              GRANT/REVOKE, strict Gregorian date validation, occurrence terminal
--              & confirmed immutability, rule tombstone field locking, transaction
--              linkage parity & confirmed transaction financial identity protection.
-- Notice: Prepared version-controlled migration script. Not automatically executed.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. RECURRING RULES TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recurring_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title VARCHAR(100) NOT NULL,
    description TEXT,
    type VARCHAR(20) NOT NULL,
    amount_paise BIGINT NOT NULL,
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
    category_id UUID REFERENCES public.categories(id) ON DELETE RESTRICT,
    frequency VARCHAR(20) NOT NULL,
    interval INTEGER NOT NULL DEFAULT 1,
    anchor_day_of_month INTEGER NOT NULL,
    start_date VARCHAR(10) NOT NULL,
    end_date VARCHAR(10),
    next_due_date VARCHAR(10) NOT NULL,
    last_generated_date VARCHAR(10),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    requires_user_confirmation BOOLEAN NOT NULL DEFAULT true,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT recurring_rules_title_not_empty CHECK (length(trim(title)) > 0),
    CONSTRAINT recurring_rules_type_check CHECK (type IN ('income', 'expense')),
    CONSTRAINT recurring_rules_amount_positive CHECK (amount_paise > 0),
    CONSTRAINT recurring_rules_frequency_check CHECK (
        frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')
    ),
    CONSTRAINT recurring_rules_interval_range CHECK (interval >= 1 AND interval <= 365),
    CONSTRAINT recurring_rules_anchor_day_range CHECK (
        anchor_day_of_month >= 1 AND anchor_day_of_month <= 31
    ),
    CONSTRAINT recurring_rules_confirmation_required CHECK (requires_user_confirmation = true),
    CONSTRAINT recurring_rules_start_date_format CHECK (
        start_date ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'
    ),
    CONSTRAINT recurring_rules_end_date_format CHECK (
        end_date IS NULL OR (
            end_date ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'
            AND end_date >= start_date
        )
    ),
    CONSTRAINT recurring_rules_next_due_date_format CHECK (
        next_due_date ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'
        AND next_due_date >= start_date
    ),
    CONSTRAINT recurring_rules_last_generated_date_format CHECK (
        last_generated_date IS NULL OR
        last_generated_date ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'
    ),
    CONSTRAINT recurring_rules_status_check CHECK (status IN ('active', 'paused', 'completed')),
    CONSTRAINT recurring_rules_version_positive CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_recurring_rules_user_id ON public.recurring_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_rules_account_id ON public.recurring_rules(account_id);
CREATE INDEX IF NOT EXISTS idx_recurring_rules_category_id ON public.recurring_rules(category_id);
CREATE INDEX IF NOT EXISTS idx_recurring_rules_user_status ON public.recurring_rules(user_id, status)
    WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_recurring_rules_user_next_due ON public.recurring_rules(user_id, next_due_date)
    WHERE (deleted_at IS NULL);

-- ------------------------------------------------------------------------------
-- 2. RECURRING OCCURRENCES TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recurring_occurrences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    recurring_rule_id UUID NOT NULL REFERENCES public.recurring_rules(id) ON DELETE RESTRICT,
    occurrence_date VARCHAR(10) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    snoozed_until_date VARCHAR(10),
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(160) NOT NULL,
    confirmed_at TIMESTAMPTZ,
    skipped_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT recurring_occurrences_idempotency_key_not_empty CHECK (length(trim(idempotency_key)) > 0),
    CONSTRAINT recurring_occurrences_date_format CHECK (
        occurrence_date ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'
    ),
    CONSTRAINT recurring_occurrences_status_check CHECK (
        status IN ('pending', 'confirmed', 'skipped', 'snoozed', 'dismissed')
    ),
    CONSTRAINT recurring_occurrences_snooze_date_format CHECK (
        snoozed_until_date IS NULL OR
        snoozed_until_date ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'
    ),
    CONSTRAINT recurring_occurrences_tx_status_consistency CHECK (
        (status = 'confirmed' AND transaction_id IS NOT NULL)
        OR (status <> 'confirmed' AND transaction_id IS NULL)
    ),
    CONSTRAINT recurring_occurrences_snooze_status_consistency CHECK (
        (status = 'snoozed' AND snoozed_until_date IS NOT NULL)
        OR (status <> 'snoozed' AND snoozed_until_date IS NULL)
    ),
    CONSTRAINT recurring_occurrences_version_positive CHECK (version >= 1)
);

-- Strictly prevent duplicate occurrences or duplicate generated ledger transactions
CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_occurrences_active_slot
    ON public.recurring_occurrences(user_id, recurring_rule_id, occurrence_date)
    WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_occurrences_active_transaction
    ON public.recurring_occurrences(transaction_id)
    WHERE (transaction_id IS NOT NULL AND deleted_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_occurrences_user_idempotency
    ON public.recurring_occurrences(user_id, idempotency_key)
    WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_recurring_occurrences_user_id ON public.recurring_occurrences(user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_occurrences_rule_id ON public.recurring_occurrences(recurring_rule_id);
CREATE INDEX IF NOT EXISTS idx_recurring_occurrences_transaction_id ON public.recurring_occurrences(transaction_id);
CREATE INDEX IF NOT EXISTS idx_recurring_occurrences_user_status ON public.recurring_occurrences(user_id, status)
    WHERE (deleted_at IS NULL);

-- ------------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY POLICIES & LEAST-PRIVILEGE GRANTS
-- ------------------------------------------------------------------------------
ALTER TABLE public.recurring_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_occurrences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own recurring rules"
    ON public.recurring_rules FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own recurring rules"
    ON public.recurring_rules FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own recurring rules"
    ON public.recurring_rules FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own recurring occurrences"
    ON public.recurring_occurrences FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own recurring occurrences"
    ON public.recurring_occurrences FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own recurring occurrences"
    ON public.recurring_occurrences FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON TABLE public.recurring_rules FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.recurring_rules TO authenticated;

REVOKE ALL ON TABLE public.recurring_occurrences FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.recurring_occurrences TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. INTERNAL GREGORIAN CALENDAR DATE VALIDATION HELPER
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_valid_gregorian_date(
    p_date TEXT,
    p_field TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_year INTEGER;
    v_month INTEGER;
    v_day INTEGER;
    v_max_day INTEGER;
BEGIN
    IF p_date IS NULL THEN
        RETURN;
    END IF;

    IF p_date !~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' THEN
        RAISE EXCEPTION 'Invalid % calendar date %: expected YYYY-MM-DD.',
            p_field, p_date
            USING ERRCODE = '22007';
    END IF;

    v_year := substr(p_date, 1, 4)::INTEGER;
    v_month := substr(p_date, 6, 2)::INTEGER;
    v_day := substr(p_date, 9, 2)::INTEGER;

    v_max_day := CASE
        WHEN v_month IN (4, 6, 9, 11) THEN 30
        WHEN v_month = 2 THEN
            CASE
                WHEN (v_year % 4 = 0 AND v_year % 100 <> 0) OR (v_year % 400 = 0) THEN 29
                ELSE 28
            END
        ELSE 31
    END;

    IF v_day < 1 OR v_day > v_max_day THEN
        RAISE EXCEPTION 'Invalid % calendar date %: day out of range for month.',
            p_field, p_date
            USING ERRCODE = '22007';
    END IF;
END;
$$;

ALTER FUNCTION public.assert_valid_gregorian_date(TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assert_valid_gregorian_date(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 5. SERVER-SIDE RECURRING RULE VALIDATION & IMMUTABILITY TRIGGER
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_recurring_rule_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_account_user_id UUID;
    v_category_user_id UUID;
    v_category_type VARCHAR(20);
    v_calling_role TEXT;
BEGIN
    v_calling_role := COALESCE(NULLIF(NULLIF(current_setting('role', true), ''), 'none'), current_user);

    IF TG_OP = 'DELETE' THEN
        IF v_calling_role IN ('authenticated', 'anon') OR current_user IN ('authenticated', 'anon') THEN
            RAISE EXCEPTION 'Unauthorized: Physical deletion of recurring rule % is prohibited for role %. Use tombstone update.',
                OLD.id, v_calling_role
                USING ERRCODE = '42501';
        END IF;
        RETURN OLD;
    END IF;

    IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Recurring rule user_id is required.'
            USING ERRCODE = '42501';
    END IF;

    IF v_calling_role IN ('authenticated', 'anon') OR current_user IN ('authenticated', 'anon') THEN
        IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'Unauthorized: Recurring rule user_id % does not match authenticated user.',
                NEW.user_id
                USING ERRCODE = '42501';
        END IF;
    ELSIF auth.uid() IS NOT NULL AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized: Recurring rule user_id % does not match authenticated user.',
            NEW.user_id
            USING ERRCODE = '42501';
    END IF;

    -- Validate all Gregorian calendar dates accurately (reject non-leap Feb 29, Apr 31, etc.)
    PERFORM public.assert_valid_gregorian_date(NEW.start_date, 'start_date');
    PERFORM public.assert_valid_gregorian_date(NEW.end_date, 'end_date');
    PERFORM public.assert_valid_gregorian_date(NEW.next_due_date, 'next_due_date');
    PERFORM public.assert_valid_gregorian_date(NEW.last_generated_date, 'last_generated_date');

    IF TG_OP = 'INSERT' THEN
        IF NEW.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Invalid recurring rule %: Cannot create with deleted_at already set.',
                NEW.id
                USING ERRCODE = '22000';
        END IF;

        IF NEW.version <> 1 THEN
            RAISE EXCEPTION 'Invalid recurring rule %: version must initialize to 1 on insert (got %).',
                NEW.id, NEW.version
                USING ERRCODE = '22000';
        END IF;

        IF NEW.requires_user_confirmation IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'Invalid recurring rule %: requires_user_confirmation must be true.',
                NEW.id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id OR
           NEW.user_id IS DISTINCT FROM OLD.user_id OR
           NEW.type IS DISTINCT FROM OLD.type OR
           NEW.start_date IS DISTINCT FROM OLD.start_date OR
           NEW.requires_user_confirmation IS DISTINCT FROM OLD.requires_user_confirmation OR
           NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Immutability violation on recurring rule %: id, user_id, type, start_date, requires_user_confirmation, and created_at are immutable.',
                OLD.id
                USING ERRCODE = '23514';
        END IF;

        IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
            RAISE EXCEPTION 'Illegal reactivation: Tombstoned recurring rule % cannot be reactivated.',
                OLD.id
                USING ERRCODE = '23514';
        END IF;

        IF OLD.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Illegal modification: Tombstoned recurring rule % cannot be altered.',
                OLD.id
                USING ERRCODE = '23514';
        END IF;

        IF OLD.status = 'completed' AND (
           NEW.status IS DISTINCT FROM 'completed' OR
           NEW.amount_paise IS DISTINCT FROM OLD.amount_paise OR
           NEW.account_id IS DISTINCT FROM OLD.account_id OR
           NEW.category_id IS DISTINCT FROM OLD.category_id OR
           NEW.frequency IS DISTINCT FROM OLD.frequency OR
           NEW.interval IS DISTINCT FROM OLD.interval OR
           NEW.next_due_date IS DISTINCT FROM OLD.next_due_date OR
           NEW.end_date IS DISTINCT FROM OLD.end_date
        ) THEN
            RAISE EXCEPTION 'Illegal modification on completed recurring rule %: financial and schedule fields are locked.',
                OLD.id
                USING ERRCODE = '23514';
        END IF;

        IF NEW.deleted_at IS NOT NULL AND (
           NEW.title IS DISTINCT FROM OLD.title OR
           NEW.description IS DISTINCT FROM OLD.description OR
           NEW.amount_paise IS DISTINCT FROM OLD.amount_paise OR
           NEW.account_id IS DISTINCT FROM OLD.account_id OR
           NEW.category_id IS DISTINCT FROM OLD.category_id OR
           NEW.frequency IS DISTINCT FROM OLD.frequency OR
           NEW.interval IS DISTINCT FROM OLD.interval OR
           NEW.anchor_day_of_month IS DISTINCT FROM OLD.anchor_day_of_month OR
           NEW.end_date IS DISTINCT FROM OLD.end_date OR
           NEW.next_due_date IS DISTINCT FROM OLD.next_due_date OR
           NEW.last_generated_date IS DISTINCT FROM OLD.last_generated_date OR
           NEW.status IS DISTINCT FROM OLD.status
        ) THEN
            RAISE EXCEPTION 'Invalid tombstone on recurring rule %: financial and schedule fields cannot change during deletion.',
                OLD.id
                USING ERRCODE = '23514';
        END IF;

        IF NEW.version <> OLD.version + 1 THEN
            RAISE EXCEPTION 'Concurrency conflict on recurring rule %: expected version % but got %.',
                OLD.id, OLD.version + 1, NEW.version
                USING ERRCODE = '40001';
        END IF;
    END IF;

    SELECT user_id
    INTO v_account_user_id
    FROM public.accounts
    WHERE id = NEW.account_id;

    IF v_account_user_id IS NULL THEN
        RAISE EXCEPTION 'Invalid account: Referenced account % does not exist.',
            NEW.account_id
            USING ERRCODE = '23503';
    END IF;

    IF v_account_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Unauthorized account reference %: belongs to a different user.',
            NEW.account_id
            USING ERRCODE = '42501';
    END IF;

    IF NEW.category_id IS NOT NULL THEN
        SELECT user_id, type
        INTO v_category_user_id, v_category_type
        FROM public.categories
        WHERE id = NEW.category_id;

        IF v_category_user_id IS NULL THEN
            RAISE EXCEPTION 'Invalid category: Referenced category % does not exist.',
                NEW.category_id
                USING ERRCODE = '23503';
        END IF;

        IF v_category_user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Unauthorized category reference %: belongs to a different user.',
                NEW.category_id
                USING ERRCODE = '42501';
        END IF;

        IF v_category_type <> NEW.type THEN
            RAISE EXCEPTION 'Invalid category type on recurring rule %: expected % category but found %.',
                NEW.id, NEW.type, v_category_type
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.validate_recurring_rule_record() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_recurring_rule_record() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_recurring_rule_record ON public.recurring_rules;
CREATE TRIGGER trg_validate_recurring_rule_record
    BEFORE INSERT OR UPDATE OR DELETE ON public.recurring_rules
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_recurring_rule_record();

-- ------------------------------------------------------------------------------
-- 6. SERVER-SIDE RECURRING OCCURRENCE VALIDATION & IDEMPOTENCY TRIGGER
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_recurring_occurrence_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_rule_user_id UUID;
    v_rule_type VARCHAR(20);
    v_rule_start_date VARCHAR(10);
    v_rule_deleted_at TIMESTAMPTZ;
    v_tx_user_id UUID;
    v_tx_type VARCHAR(20);
    v_tx_deleted_at TIMESTAMPTZ;
    v_calling_role TEXT;
BEGIN
    v_calling_role := COALESCE(NULLIF(NULLIF(current_setting('role', true), ''), 'none'), current_user);

    IF TG_OP = 'DELETE' THEN
        IF v_calling_role IN ('authenticated', 'anon') OR current_user IN ('authenticated', 'anon') THEN
            RAISE EXCEPTION 'Unauthorized: Physical deletion of recurring occurrence % is prohibited for role %. Use tombstone update.',
                OLD.id, v_calling_role
                USING ERRCODE = '42501';
        END IF;
        RETURN OLD;
    END IF;

    IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Recurring occurrence user_id is required.'
            USING ERRCODE = '42501';
    END IF;

    IF v_calling_role IN ('authenticated', 'anon') OR current_user IN ('authenticated', 'anon') THEN
        IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'Unauthorized: Recurring occurrence user_id % does not match authenticated user.',
                NEW.user_id
                USING ERRCODE = '42501';
        END IF;
    ELSIF auth.uid() IS NOT NULL AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized: Recurring occurrence user_id % does not match authenticated user.',
            NEW.user_id
            USING ERRCODE = '42501';
    END IF;

    PERFORM public.assert_valid_gregorian_date(NEW.occurrence_date, 'occurrence_date');
    PERFORM public.assert_valid_gregorian_date(NEW.snoozed_until_date, 'snoozed_until_date');

    IF TG_OP = 'INSERT' THEN
        IF NEW.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Invalid recurring occurrence %: Cannot create with deleted_at already set.',
                NEW.id
                USING ERRCODE = '22000';
        END IF;

        IF NEW.version <> 1 THEN
            RAISE EXCEPTION 'Invalid recurring occurrence %: version must initialize to 1 on insert (got %).',
                NEW.id, NEW.version
                USING ERRCODE = '22000';
        END IF;
    END IF;

    SELECT user_id, type, start_date, deleted_at
    INTO v_rule_user_id, v_rule_type, v_rule_start_date, v_rule_deleted_at
    FROM public.recurring_rules
    WHERE id = NEW.recurring_rule_id;

    IF v_rule_user_id IS NULL THEN
        RAISE EXCEPTION 'Invalid recurring rule: Referenced schedule % does not exist.',
            NEW.recurring_rule_id
            USING ERRCODE = '23503';
    END IF;

    IF v_rule_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Unauthorized recurring schedule reference %: belongs to a different user.',
            NEW.recurring_rule_id
            USING ERRCODE = '42501';
    END IF;

    IF v_rule_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid recurring occurrence %: cannot attach or update occurrence on tombstoned schedule %.',
            NEW.id, NEW.recurring_rule_id
            USING ERRCODE = '23514';
    END IF;

    IF NEW.occurrence_date < v_rule_start_date THEN
        RAISE EXCEPTION 'Invalid occurrence date %: cannot be earlier than schedule start_date %.',
            NEW.occurrence_date, v_rule_start_date
            USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'confirmed' AND NEW.confirmed_at IS NULL THEN
        NEW.confirmed_at := now();
    END IF;

    IF NEW.transaction_id IS NOT NULL THEN
        SELECT user_id, type, deleted_at
        INTO v_tx_user_id, v_tx_type, v_tx_deleted_at
        FROM public.transactions
        WHERE id = NEW.transaction_id;

        IF v_tx_user_id IS NULL THEN
            RAISE EXCEPTION 'Invalid transaction reference: Transaction % does not exist.',
                NEW.transaction_id
                USING ERRCODE = '23503';
        END IF;

        IF v_tx_user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Unauthorized transaction reference %: belongs to a different user.',
                NEW.transaction_id
                USING ERRCODE = '42501';
        END IF;

        IF v_tx_deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Invalid transaction reference: Linked transaction % has been soft-deleted.',
                NEW.transaction_id
                USING ERRCODE = '22000';
        END IF;

        IF v_tx_type <> v_rule_type THEN
            RAISE EXCEPTION 'Transaction type mismatch on recurring occurrence %: expected % transaction but found %.',
                NEW.id, v_rule_type, v_tx_type
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id OR
           NEW.user_id IS DISTINCT FROM OLD.user_id OR
           NEW.recurring_rule_id IS DISTINCT FROM OLD.recurring_rule_id OR
           NEW.occurrence_date IS DISTINCT FROM OLD.occurrence_date OR
           NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
           NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Immutability violation on recurring occurrence %: identity fields cannot be modified.',
                OLD.id
                USING ERRCODE = '23514';
        END IF;

        IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
            RAISE EXCEPTION 'Illegal reactivation: Tombstoned recurring occurrence % cannot be reactivated.',
                OLD.id
                USING ERRCODE = '23514';
        END IF;

        IF OLD.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Illegal modification: Tombstoned recurring occurrence % cannot be altered.',
                OLD.id
                USING ERRCODE = '23514';
        END IF;

        IF OLD.status = 'confirmed' THEN
            IF NEW.status IS DISTINCT FROM 'confirmed' OR
               NEW.transaction_id IS DISTINCT FROM OLD.transaction_id OR
               NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR
               NEW.skipped_at IS DISTINCT FROM OLD.skipped_at OR
               NEW.dismissed_at IS DISTINCT FROM OLD.dismissed_at OR
               NEW.snoozed_until_date IS DISTINCT FROM OLD.snoozed_until_date OR
               NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
                RAISE EXCEPTION 'Immutability violation on confirmed recurring occurrence %: status, transaction_id, confirmed_at, skipped_at, dismissed_at, snoozed_until_date, and deleted_at are locked.',
                    OLD.id
                    USING ERRCODE = '23514';
            END IF;
        END IF;

        IF OLD.status IN ('skipped', 'dismissed') THEN
            IF NEW.status IS DISTINCT FROM OLD.status OR
               NEW.transaction_id IS DISTINCT FROM OLD.transaction_id OR
               NEW.snoozed_until_date IS DISTINCT FROM OLD.snoozed_until_date OR
               NEW.skipped_at IS DISTINCT FROM OLD.skipped_at OR
               NEW.dismissed_at IS DISTINCT FROM OLD.dismissed_at THEN
                RAISE EXCEPTION 'Illegal state transition on recurring occurrence %: terminal status % is irreversible.',
                    OLD.id, OLD.status
                    USING ERRCODE = '23514';
            END IF;
        END IF;

        IF NEW.version <> OLD.version + 1 THEN
            RAISE EXCEPTION 'Concurrency conflict on recurring occurrence %: expected version % but got %.',
                OLD.id, OLD.version + 1, NEW.version
                USING ERRCODE = '40001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.validate_recurring_occurrence_record() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_recurring_occurrence_record() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_recurring_occurrence_record ON public.recurring_occurrences;
CREATE TRIGGER trg_validate_recurring_occurrence_record
    BEFORE INSERT OR UPDATE OR DELETE ON public.recurring_occurrences
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_recurring_occurrence_record();

-- ------------------------------------------------------------------------------
-- 7. PROTECT CONFIRMED RECURRING LINKED TRANSACTIONS
-- Scoped strictly to transactions referenced by an active confirmed recurring
-- occurrence. Ordinary unlinked transactions remain completely unrestricted.
-- Preserves non-financial metadata edits (title, note, category within same type,
-- transaction_date, version, device_id, updated_at) while locking user_id,
-- deleted_at, type, amount_paise, currency, account_id, and destination_account_id.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_recurring_linked_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_occ_id UUID;
BEGIN
    SELECT id
    INTO v_occ_id
    FROM public.recurring_occurrences
    WHERE transaction_id = OLD.id
      AND status = 'confirmed'
      AND deleted_at IS NULL
    LIMIT 1;

    IF v_occ_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Cannot delete transaction %: It is linked to confirmed recurring occurrence %.',
            OLD.id, v_occ_id
            USING ERRCODE = '22000';
    END IF;

    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
        RAISE EXCEPTION 'Cannot change deleted_at on transaction %: It is linked to confirmed recurring occurrence %.',
            OLD.id, v_occ_id
            USING ERRCODE = '22000';
    END IF;

    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'Cannot change user_id on transaction %: It is linked to confirmed recurring occurrence %.',
            OLD.id, v_occ_id
            USING ERRCODE = '42501';
    END IF;

    IF NEW.type IS DISTINCT FROM OLD.type THEN
        RAISE EXCEPTION 'Cannot change type on transaction %: It is linked to confirmed recurring occurrence %.',
            OLD.id, v_occ_id
            USING ERRCODE = '23514';
    END IF;

    IF NEW.amount_paise IS DISTINCT FROM OLD.amount_paise THEN
        RAISE EXCEPTION 'Cannot change amount_paise on transaction %: It is linked to confirmed recurring occurrence %.',
            OLD.id, v_occ_id
            USING ERRCODE = '23514';
    END IF;

    IF NEW.currency IS DISTINCT FROM OLD.currency THEN
        RAISE EXCEPTION 'Cannot change currency on transaction %: It is linked to confirmed recurring occurrence %.',
            OLD.id, v_occ_id
            USING ERRCODE = '23514';
    END IF;

    IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
        RAISE EXCEPTION 'Cannot change account_id on transaction %: It is linked to confirmed recurring occurrence %.',
            OLD.id, v_occ_id
            USING ERRCODE = '23514';
    END IF;

    IF NEW.destination_account_id IS DISTINCT FROM OLD.destination_account_id THEN
        RAISE EXCEPTION 'Cannot change destination_account_id on transaction %: It is linked to confirmed recurring occurrence %.',
            OLD.id, v_occ_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.protect_recurring_linked_transactions() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.protect_recurring_linked_transactions() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_recurring_linked_transactions ON public.transactions;
CREATE TRIGGER trg_protect_recurring_linked_transactions
    BEFORE UPDATE OR DELETE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_recurring_linked_transactions();
