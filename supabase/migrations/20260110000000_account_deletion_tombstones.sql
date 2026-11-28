-- ==============================================================================
-- Migration: 20260110000000_account_deletion_tombstones.sql
-- Description: Adds soft-delete tombstones (deleted_at) to public.accounts so
--              permanent deletions propagate reliably across all authenticated
--              devices while preventing cascade deletion, stale un-deletion, or
--              dangling references from offline transactions and schedules.
-- Notice: Prepared version-controlled migration script. Apply manually in Supabase.
-- ==============================================================================

-- 1. Add tombstone column and supporting indexes on public.accounts
ALTER TABLE public.accounts
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.accounts.deleted_at IS 'Tombstone timestamp for permanently deleted accounts; NULL indicates an active/archived visible account.';

CREATE INDEX IF NOT EXISTS idx_accounts_deleted_at
    ON public.accounts(deleted_at);

CREATE INDEX IF NOT EXISTS idx_accounts_user_active
    ON public.accounts(user_id, is_archived)
    WHERE (deleted_at IS NULL);

-- 2. Remove direct client DELETE access on public.accounts (tombstones via RPC only)
-- Preserves administrative / service-role and auth.users cleanup operations.
DROP POLICY IF EXISTS "Users can delete their own accounts" ON public.accounts;

REVOKE ALL ON TABLE public.accounts FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.accounts TO authenticated;

-- 3. Protect account tombstones, validate direct tombstone transitions, and block client physical DELETE
CREATE OR REPLACE FUNCTION public.protect_tombstoned_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_calling_role TEXT;
BEGIN
    v_calling_role := COALESCE(
        NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
        current_user
    );

    IF TG_OP = 'DELETE' THEN
        IF v_calling_role IN ('authenticated', 'anon')
           OR current_user IN ('authenticated', 'anon') THEN
            RAISE EXCEPTION 'Unauthorized: Physical deletion of account % is prohibited for role %. Use safe_delete_account tombstone RPC.',
                OLD.id, v_calling_role
                USING ERRCODE = '42501';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Invalid account %: New accounts cannot be inserted with deleted_at already set.', NEW.id
                USING ERRCODE = '22000';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Direct client (authenticated/anon) updates cannot set or modify deleted_at.
        -- safe_delete_account (SECURITY DEFINER, OWNER TO postgres) is the exclusive client path.
        IF (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
           AND current_user IN ('authenticated', 'anon') THEN
            RAISE EXCEPTION 'Unauthorized: Role % cannot directly set or modify deleted_at on account %. Use safe_delete_account RPC.',
                current_user, OLD.id
                USING ERRCODE = '42501';
        END IF;

        -- Once tombstoned, never permit reactivation or subsequent mutation
        IF OLD.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Account % has already been permanently deleted (tombstoned) and cannot be modified or reactivated.', OLD.id
                USING ERRCODE = '40001';
        END IF;

        -- Enforce complete tombstone invariants whenever deleted_at transitions from NULL to non-NULL
        IF NEW.deleted_at IS NOT NULL THEN
            IF OLD.system_tag IS NOT NULL
               OR lower(trim(OLD.name)) = 'personal borrowings' THEN
                RAISE EXCEPTION 'Unauthorized: System-managed account % cannot be tombstoned.', OLD.id
                    USING ERRCODE = '42501';
            END IF;

            IF NEW.version IS DISTINCT FROM (OLD.version + 1) THEN
                RAISE EXCEPTION 'Version conflict tombstoning account %: expected version %, found %.',
                    OLD.id, OLD.version + 1, NEW.version
                    USING ERRCODE = '40001';
            END IF;

            IF NEW.id IS DISTINCT FROM OLD.id
               OR NEW.user_id IS DISTINCT FROM OLD.user_id
               OR NEW.name IS DISTINCT FROM OLD.name
               OR NEW.account_type IS DISTINCT FROM OLD.account_type
               OR NEW.opening_balance_paise IS DISTINCT FROM OLD.opening_balance_paise
               OR NEW.currency IS DISTINCT FROM OLD.currency
               OR NEW.institution_name IS DISTINCT FROM OLD.institution_name
               OR NEW.color IS DISTINCT FROM OLD.color
               OR NEW.icon IS DISTINCT FROM OLD.icon
               OR NEW.notes IS DISTINCT FROM OLD.notes
               OR NEW.system_tag IS DISTINCT FROM OLD.system_tag
               OR NEW.is_archived IS DISTINCT FROM OLD.is_archived
               OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                RAISE EXCEPTION 'Invalid tombstone transition on account %: identity, metadata, and financial fields cannot change during deletion.',
                    OLD.id
                    USING ERRCODE = '23514';
            END IF;

            IF EXISTS (
                SELECT 1
                FROM public.transactions
                WHERE user_id = OLD.user_id
                  AND (account_id = OLD.id OR destination_account_id = OLD.id)
            ) THEN
                RAISE EXCEPTION 'Account % cannot be deleted because active or deleted transactions reference it.', OLD.id
                    USING ERRCODE = '23503';
            END IF;

            IF EXISTS (
                SELECT 1
                FROM public.recurring_rules
                WHERE user_id = OLD.user_id
                  AND account_id = OLD.id
            ) THEN
                RAISE EXCEPTION 'Account % cannot be deleted because recurring rules reference it.', OLD.id
                    USING ERRCODE = '23503';
            END IF;

            IF EXISTS (
                SELECT 1
                FROM public.borrowings
                WHERE user_id = OLD.user_id
                  AND receiving_account_id = OLD.id
            ) THEN
                RAISE EXCEPTION 'Account % cannot be deleted because borrowing records reference it.', OLD.id
                    USING ERRCODE = '23503';
            END IF;

            IF EXISTS (
                SELECT 1
                FROM public.borrowing_repayments
                WHERE user_id = OLD.user_id
                  AND payment_account_id = OLD.id
            ) THEN
                RAISE EXCEPTION 'Account % cannot be deleted because borrowing repayments reference it.', OLD.id
                    USING ERRCODE = '23503';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.protect_tombstoned_account() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.protect_tombstoned_account() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_tombstoned_account ON public.accounts;
CREATE TRIGGER trg_protect_tombstoned_account
    BEFORE INSERT OR UPDATE OR DELETE ON public.accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_tombstoned_account();

-- 4. Prevent concurrent/offline inserts or updates from referencing a tombstoned account.
-- Locks referenced accounts FOR SHARE in deterministic UUID order (ORDER BY id ASC):
--   - Compatible with concurrent FOR SHARE reads on active accounts.
--   - Conflicts with safe_delete_account (FOR UPDATE) and direct account UPDATE (FOR NO KEY UPDATE),
--     closing READ COMMITTED TOCTOU races without transfer lock-order deadlocks.
CREATE OR REPLACE FUNCTION public.reject_tombstoned_account_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_deleted_at TIMESTAMPTZ;
    v_check_src_id UUID;
    v_check_dst_id UUID;
    v_account RECORD;
BEGIN
    IF TG_TABLE_NAME = 'transactions' THEN
        v_check_src_id := CASE
            WHEN TG_OP = 'INSERT' OR NEW.account_id IS DISTINCT FROM OLD.account_id
            THEN NEW.account_id
            ELSE NULL
        END;

        v_check_dst_id := CASE
            WHEN NEW.destination_account_id IS NOT NULL
                 AND (TG_OP = 'INSERT' OR NEW.destination_account_id IS DISTINCT FROM OLD.destination_account_id)
            THEN NEW.destination_account_id
            ELSE NULL
        END;

        IF v_check_src_id IS NOT NULL OR v_check_dst_id IS NOT NULL THEN
            FOR v_account IN
                SELECT id, deleted_at
                FROM public.accounts
                WHERE id = ANY(ARRAY[v_check_src_id, v_check_dst_id])
                  AND user_id = NEW.user_id
                ORDER BY id ASC
                FOR SHARE
            LOOP
                IF v_account.deleted_at IS NOT NULL THEN
                    IF v_account.id = NEW.account_id THEN
                        RAISE EXCEPTION 'Referenced account % has been permanently deleted.', NEW.account_id
                            USING ERRCODE = '23503';
                    END IF;
                    RAISE EXCEPTION 'Referenced destination account % has been permanently deleted.', NEW.destination_account_id
                        USING ERRCODE = '23503';
                END IF;
            END LOOP;
        END IF;
    ELSIF TG_TABLE_NAME = 'recurring_rules' THEN
        IF TG_OP = 'INSERT' OR NEW.account_id IS DISTINCT FROM OLD.account_id THEN
            SELECT deleted_at INTO v_deleted_at
            FROM public.accounts
            WHERE id = NEW.account_id
              AND user_id = NEW.user_id
            FOR SHARE;
            IF v_deleted_at IS NOT NULL THEN
                RAISE EXCEPTION 'Referenced account % has been permanently deleted.', NEW.account_id
                    USING ERRCODE = '23503';
            END IF;
        END IF;
    ELSIF TG_TABLE_NAME = 'borrowings' THEN
        IF TG_OP = 'INSERT' OR NEW.receiving_account_id IS DISTINCT FROM OLD.receiving_account_id THEN
            SELECT deleted_at INTO v_deleted_at
            FROM public.accounts
            WHERE id = NEW.receiving_account_id
              AND user_id = NEW.user_id
            FOR SHARE;
            IF v_deleted_at IS NOT NULL THEN
                RAISE EXCEPTION 'Referenced account % has been permanently deleted.', NEW.receiving_account_id
                    USING ERRCODE = '23503';
            END IF;
        END IF;
    ELSIF TG_TABLE_NAME = 'borrowing_repayments' THEN
        IF TG_OP = 'INSERT' OR NEW.payment_account_id IS DISTINCT FROM OLD.payment_account_id THEN
            SELECT deleted_at INTO v_deleted_at
            FROM public.accounts
            WHERE id = NEW.payment_account_id
              AND user_id = NEW.user_id
            FOR SHARE;
            IF v_deleted_at IS NOT NULL THEN
                RAISE EXCEPTION 'Referenced account % has been permanently deleted.', NEW.payment_account_id
                    USING ERRCODE = '23503';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.reject_tombstoned_account_reference() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_tombstoned_account_reference() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reject_tombstoned_account_tx ON public.transactions;
CREATE TRIGGER trg_reject_tombstoned_account_tx
    BEFORE INSERT OR UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.reject_tombstoned_account_reference();

DROP TRIGGER IF EXISTS trg_reject_tombstoned_account_rule ON public.recurring_rules;
CREATE TRIGGER trg_reject_tombstoned_account_rule
    BEFORE INSERT OR UPDATE ON public.recurring_rules
    FOR EACH ROW
    EXECUTE FUNCTION public.reject_tombstoned_account_reference();

DROP TRIGGER IF EXISTS trg_reject_tombstoned_account_borrowing ON public.borrowings;
CREATE TRIGGER trg_reject_tombstoned_account_borrowing
    BEFORE INSERT OR UPDATE ON public.borrowings
    FOR EACH ROW
    EXECUTE FUNCTION public.reject_tombstoned_account_reference();

DROP TRIGGER IF EXISTS trg_reject_tombstoned_account_repayment ON public.borrowing_repayments;
CREATE TRIGGER trg_reject_tombstoned_account_repayment
    BEFORE INSERT OR UPDATE ON public.borrowing_repayments
    FOR EACH ROW
    EXECUTE FUNCTION public.reject_tombstoned_account_reference();

-- 5. Update safe_delete_account RPC to record irreversible cloud tombstones exclusively via RPC
DROP FUNCTION IF EXISTS public.safe_delete_account(UUID, INT);
DROP FUNCTION IF EXISTS public.safe_delete_account(UUID, INT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.safe_delete_account(
    p_account_id UUID,
    p_expected_version INT DEFAULT NULL,
    p_deleted_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_user_id UUID;
    v_account public.accounts;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required to delete an account.'
            USING ERRCODE = '42501';
    END IF;

    IF p_account_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Lock target owned account BEFORE dependency checks (closed under READ COMMITTED with child FOR SHARE)
    SELECT * INTO v_account
    FROM public.accounts
    WHERE id = p_account_id
      AND user_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF v_account.system_tag IS NOT NULL
       OR lower(trim(v_account.name)) = 'personal borrowings' THEN
        RAISE EXCEPTION 'Unauthorized: System-managed account % cannot be deleted.', p_account_id
            USING ERRCODE = '42501';
    END IF;

    -- Idempotent retry when already tombstoned at expected target version
    IF v_account.deleted_at IS NOT NULL THEN
        IF p_expected_version IS NOT NULL AND v_account.version <> (p_expected_version + 1) THEN
            RAISE EXCEPTION 'Version conflict on tombstoned account %: expected %, found %.',
                p_account_id, p_expected_version, v_account.version
                USING ERRCODE = '40001';
        END IF;
        RETURN TRUE;
    END IF;

    IF p_expected_version IS NOT NULL AND v_account.version <> p_expected_version THEN
        RAISE EXCEPTION 'Version conflict on account %: expected %, found %.',
            p_account_id, p_expected_version, v_account.version
            USING ERRCODE = '40001';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.transactions
        WHERE user_id = v_user_id
          AND (account_id = p_account_id OR destination_account_id = p_account_id)
    ) THEN
        RAISE EXCEPTION 'Account % cannot be deleted because active or deleted transactions reference it.', p_account_id
            USING ERRCODE = '23503';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.recurring_rules
        WHERE user_id = v_user_id
          AND account_id = p_account_id
    ) THEN
        RAISE EXCEPTION 'Account % cannot be deleted because recurring rules reference it.', p_account_id
            USING ERRCODE = '23503';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.borrowings
        WHERE user_id = v_user_id
          AND receiving_account_id = p_account_id
    ) THEN
        RAISE EXCEPTION 'Account % cannot be deleted because borrowing records reference it.', p_account_id
            USING ERRCODE = '23503';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.borrowing_repayments
        WHERE user_id = v_user_id
          AND payment_account_id = p_account_id
    ) THEN
        RAISE EXCEPTION 'Account % cannot be deleted because borrowing repayments reference it.', p_account_id
            USING ERRCODE = '23503';
    END IF;

    UPDATE public.accounts
    SET deleted_at = COALESCE(p_deleted_at, timezone('utc', now())),
        version = v_account.version + 1,
        updated_at = timezone('utc', now())
    WHERE id = p_account_id
      AND user_id = v_user_id
      AND version = v_account.version
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Concurrency conflict while tombstoning account %.', p_account_id
            USING ERRCODE = '40001';
    END IF;

    RETURN TRUE;
END;
$$;

ALTER FUNCTION public.safe_delete_account(UUID, INT, TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.safe_delete_account(UUID, INT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.safe_delete_account(UUID, INT, TIMESTAMPTZ) TO authenticated;
