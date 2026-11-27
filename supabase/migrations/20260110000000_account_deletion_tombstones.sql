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

-- 2. Protect account tombstones against reactivation or modification
CREATE OR REPLACE FUNCTION public.protect_tombstoned_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Invalid account %: New accounts cannot be inserted with deleted_at already set.', NEW.id
                USING ERRCODE = '22000';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Account % has already been permanently deleted (tombstoned) and cannot be modified or reactivated.', OLD.id
                USING ERRCODE = '40001';
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_tombstoned_account ON public.accounts;
CREATE TRIGGER trg_protect_tombstoned_account
    BEFORE INSERT OR UPDATE ON public.accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_tombstoned_account();

-- 3. Prevent offline/stale inserts from referencing a tombstoned account
CREATE OR REPLACE FUNCTION public.reject_tombstoned_account_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_deleted_at TIMESTAMPTZ;
BEGIN
    IF TG_TABLE_NAME = 'transactions' THEN
        SELECT deleted_at INTO v_deleted_at
        FROM public.accounts
        WHERE id = NEW.account_id;
        IF v_deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Referenced account % has been permanently deleted.', NEW.account_id
                USING ERRCODE = '23503';
        END IF;

        IF NEW.destination_account_id IS NOT NULL THEN
            SELECT deleted_at INTO v_deleted_at
            FROM public.accounts
            WHERE id = NEW.destination_account_id;
            IF v_deleted_at IS NOT NULL THEN
                RAISE EXCEPTION 'Referenced destination account % has been permanently deleted.', NEW.destination_account_id
                    USING ERRCODE = '23503';
            END IF;
        END IF;
    ELSIF TG_TABLE_NAME = 'recurring_rules' THEN
        SELECT deleted_at INTO v_deleted_at
        FROM public.accounts
        WHERE id = NEW.account_id;
        IF v_deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Referenced account % has been permanently deleted.', NEW.account_id
                USING ERRCODE = '23503';
        END IF;
    ELSIF TG_TABLE_NAME = 'borrowings' THEN
        SELECT deleted_at INTO v_deleted_at
        FROM public.accounts
        WHERE id = NEW.receiving_account_id;
        IF v_deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Referenced account % has been permanently deleted.', NEW.receiving_account_id
                USING ERRCODE = '23503';
        END IF;
    ELSIF TG_TABLE_NAME = 'borrowing_repayments' THEN
        SELECT deleted_at INTO v_deleted_at
        FROM public.accounts
        WHERE id = NEW.payment_account_id;
        IF v_deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Referenced account % has been permanently deleted.', NEW.payment_account_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_tombstoned_account_tx ON public.transactions;
CREATE TRIGGER trg_reject_tombstoned_account_tx
    BEFORE INSERT ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.reject_tombstoned_account_reference();

DROP TRIGGER IF EXISTS trg_reject_tombstoned_account_rule ON public.recurring_rules;
CREATE TRIGGER trg_reject_tombstoned_account_rule
    BEFORE INSERT ON public.recurring_rules
    FOR EACH ROW
    EXECUTE FUNCTION public.reject_tombstoned_account_reference();

DROP TRIGGER IF EXISTS trg_reject_tombstoned_account_borrowing ON public.borrowings;
CREATE TRIGGER trg_reject_tombstoned_account_borrowing
    BEFORE INSERT ON public.borrowings
    FOR EACH ROW
    EXECUTE FUNCTION public.reject_tombstoned_account_reference();

DROP TRIGGER IF EXISTS trg_reject_tombstoned_account_repayment ON public.borrowing_repayments;
CREATE TRIGGER trg_reject_tombstoned_account_repayment
    BEFORE INSERT ON public.borrowing_repayments
    FOR EACH ROW
    EXECUTE FUNCTION public.reject_tombstoned_account_reference();

-- 4. Update safe_delete_account RPC to record irreversible cloud tombstones
DROP FUNCTION IF EXISTS public.safe_delete_account(UUID, INT);
DROP FUNCTION IF EXISTS public.safe_delete_account(UUID, INT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.safe_delete_account(
    p_account_id UUID,
    p_expected_version INT DEFAULT NULL,
    p_deleted_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
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

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.safe_delete_account(UUID, INT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.safe_delete_account(UUID, INT, TIMESTAMPTZ) TO authenticated;
