-- ==============================================================================
-- Migration: 20260109000000_safe_account_deletion.sql
-- Description: Replaces ON DELETE CASCADE on public.transactions.account_id with
--              ON DELETE RESTRICT and adds concurrency-safe, dependency-verified
--              public.safe_delete_account RPC preserving all financial audit trails.
-- Notice: Prepared version-controlled migration script.
-- ==============================================================================

-- 1. Ensure transactions referencing an account as source NEVER cascade-delete
DO $$
DECLARE
    v_constraint_name TEXT;
    v_confdeltype "char";
BEGIN
    SELECT c.conname, c.confdeltype
    INTO v_constraint_name, v_confdeltype
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'public.transactions'::regclass
      AND c.confrelid = 'public.accounts'::regclass
      AND c.contype = 'f'
      AND array_length(c.conkey, 1) = 1
      AND a.attname = 'account_id'
    LIMIT 1;

    -- Skip dropping and recreating FK when already ON DELETE RESTRICT ('r')
    IF v_confdeltype = 'r' THEN
        RETURN;
    END IF;

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE public.transactions DROP CONSTRAINT %I',
            v_constraint_name
        );
    END IF;

    ALTER TABLE public.transactions
        ADD CONSTRAINT transactions_account_id_fkey
        FOREIGN KEY (account_id)
        REFERENCES public.accounts(id)
        ON DELETE RESTRICT;
END $$;

-- 2. Dependency-verified, version-checked safe account deletion RPC (legacy 2-arg)
-- Guard against restoring the legacy physical-delete RPC if tombstones (20260110) are already installed.
DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = 'public.accounts'::regclass
          AND a.attname = 'deleted_at'
          AND NOT a.attisdropped
    ) OR to_regprocedure('public.safe_delete_account(uuid, integer, timestamptz)') IS NOT NULL THEN
        RETURN;
    END IF;

    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.safe_delete_account(
    p_account_id UUID,
    p_expected_version INT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $_body$
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

    -- Idempotent retry behavior when row no longer exists under authenticated user RLS
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF v_account.system_tag IS NOT NULL
       OR lower(trim(v_account.name)) = 'personal borrowings' THEN
        RAISE EXCEPTION 'Unauthorized: System-managed account % cannot be deleted.', p_account_id
            USING ERRCODE = '42501';
    END IF;

    IF p_expected_version IS NOT NULL AND v_account.version <> p_expected_version THEN
        RAISE EXCEPTION 'Version conflict on account %: expected %, found %.',
            p_account_id, p_expected_version, v_account.version
            USING ERRCODE = '40001';
    END IF;

    -- Check all financial and scheduling dependencies including soft-deleted tombstones
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

    DELETE FROM public.accounts
    WHERE id = p_account_id
      AND user_id = v_user_id;

    RETURN TRUE;
END;
$_body$;
$fn$;

    REVOKE ALL ON FUNCTION public.safe_delete_account(UUID, INT) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.safe_delete_account(UUID, INT) TO authenticated;
END $migration$;
