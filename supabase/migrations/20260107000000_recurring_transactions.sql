-- ==============================================================================
-- Migration: 20260107000000_recurring_transactions.sql
-- Description: Hardened Recurring Transactions & Payment Reminders schema:
--              public.recurring_rules & public.recurring_occurrences tables,
--              partial active uniqueness preventing duplicate occurrences/transactions,
--              Row Level Security policies, least-privilege GRANT/REVOKE,
--              account/category/transaction ownership & type validation,
--              identity/ownership immutability, monotonic OCC versioning,
--              and irreversible tombstone soft-deletion.
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

    CONSTRAINT recurring_rules_type_check CHECK (type IN ('income', 'expense')),
    CONSTRAINT recurring_rules_amount_positive CHECK (amount_paise > 0),
    CONSTRAINT recurring_rules_frequency_check CHECK (
        frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')
    ),
    CONSTRAINT recurring_rules_interval_range CHECK (interval >= 1 AND interval <= 365),
    CONSTRAINT recurring_rules_anchor_day_range CHECK (
        anchor_day_of_month >= 1 AND anchor_day_of_month <= 31
    ),
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
    ),
    CONSTRAINT recurring_rules_last_generated_date_format CHECK (
        last_generated_date IS NULL OR
        last_generated_date ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'
    ),
    CONSTRAINT recurring_rules_status_check CHECK (status IN ('active', 'paused', 'completed')),
    CONSTRAINT recurring_rules_version_positive CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_recurring_rules_user_id ON public.recurring_rules(user_id);
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
    CONSTRAINT recurring_occurrences_confirmed_tx_required CHECK (
        status <> 'confirmed' OR transaction_id IS NOT NULL
    ),
    CONSTRAINT recurring_occurrences_snoozed_until_required CHECK (
        status <> 'snoozed' OR snoozed_until_date IS NOT NULL
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
-- 4. SERVER-SIDE RECURRING RULE VALIDATION & IMMUTABILITY TRIGGER
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
    v_calling_role := current_setting('role', true);

    IF TG_OP = 'DELETE' THEN
        IF v_calling_role IN ('authenticated', 'anon') THEN
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

    IF v_calling_role IN ('authenticated', 'anon') THEN
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

    IF TG_OP = 'INSERT' AND NEW.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid recurring rule %: Cannot create with deleted_at already set.',
            NEW.id
            USING ERRCODE = '22000';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id OR
           NEW.user_id IS DISTINCT FROM OLD.user_id OR
           NEW.type IS DISTINCT FROM OLD.type OR
           NEW.start_date IS DISTINCT FROM OLD.start_date OR
           NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Immutability violation on recurring rule %: id, user_id, type, start_date, and created_at are immutable.',
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
-- 5. SERVER-SIDE RECURRING OCCURRENCE VALIDATION & IDEMPOTENCY TRIGGER
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_recurring_occurrence_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_rule_user_id UUID;
    v_tx_user_id UUID;
    v_calling_role TEXT;
BEGIN
    v_calling_role := current_setting('role', true);

    IF TG_OP = 'DELETE' THEN
        IF v_calling_role IN ('authenticated', 'anon') THEN
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

    IF v_calling_role IN ('authenticated', 'anon') THEN
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

    IF TG_OP = 'INSERT' AND NEW.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid recurring occurrence %: Cannot create with deleted_at already set.',
            NEW.id
            USING ERRCODE = '22000';
    END IF;

    SELECT user_id
    INTO v_rule_user_id
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

    IF NEW.transaction_id IS NOT NULL THEN
        SELECT user_id
        INTO v_tx_user_id
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

        IF OLD.status = 'confirmed' AND NEW.status IS DISTINCT FROM 'confirmed' THEN
            RAISE EXCEPTION 'Illegal state transition on recurring occurrence %: confirmed occurrence cannot change status.',
                OLD.id
                USING ERRCODE = '23514';
        END IF;

        IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
            RAISE EXCEPTION 'Illegal reactivation: Tombstoned recurring occurrence % cannot be reactivated.',
                OLD.id
                USING ERRCODE = '23514';
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
