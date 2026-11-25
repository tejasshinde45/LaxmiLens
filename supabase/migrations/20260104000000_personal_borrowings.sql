-- ==============================================================================
-- Migration: 20260104000000_personal_borrowings.sql
-- Description: Final hardened personal borrowings sub-ledger: lenders, borrowings,
--              and borrowing_repayments with Row Level Security, least-privilege GRANTs,
--              concurrency row-locking, aggregate liability account identity verification,
--              linked transaction immutability protection, irreversible settlement status,
--              repayment immutability, and principal settlement enforcement.
-- Notice: Prepared version-controlled migration script. Not automatically executed.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 0. SYSTEM ACCOUNT IDENTITY SCHEMA EXTENSION & AUTHORIZATION (ACCOUNTS)
-- Extends public.accounts with a durable, user-scoped system_tag column to reliably
-- identify system-managed accounts (such as personal borrowings aggregate liability)
-- without relying on fragile, user-editable display names.
-- Enforces database-level protection against unauthorized assignment, alteration,
-- or clearing of system_tag, and provides a concurrency-safe, authorized SECURITY DEFINER
-- provisioning function. Ambiguous automatic backfill of pre-existing accounts is
-- omitted to guarantee strict data preservation and provenance.
-- ------------------------------------------------------------------------------
ALTER TABLE public.accounts
    ADD COLUMN IF NOT EXISTS system_tag VARCHAR(50);

COMMENT ON COLUMN public.accounts.system_tag IS 'Durable machine-readable identifier for user-scoped system-managed accounts (e.g. personal_borrowings). NULL for standard user accounts.';

-- Guarantee durable uniqueness: at most one account per system_tag per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_user_system_tag
    ON public.accounts(user_id, system_tag)
    WHERE (system_tag IS NOT NULL);

-- ------------------------------------------------------------------------------
-- AUTHORIZED SYSTEM ACCOUNT PROVISIONING FUNCTION (SECURITY DEFINER)
-- Concurrency-safe, authorized mechanism to provision the Personal Borrowings liability account.
-- Enforces strict authentication (auth.uid()), transaction-level advisory locking to serialize
-- concurrent requests per user, strict liability classification ('other'), zero opening balance,
-- user-scoped isolation, and idempotent resolution.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_personal_borrowings_account(
    p_account_id UUID DEFAULT NULL,
    p_name VARCHAR(100) DEFAULT 'Personal Borrowings',
    p_currency VARCHAR(3) DEFAULT 'INR',
    p_color VARCHAR(30) DEFAULT '#D6AD60',
    p_icon VARCHAR(50) DEFAULT 'hand-coins',
    p_notes TEXT DEFAULT 'Aggregate liability account for personal borrowings'
)
RETURNS public.accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_user_id UUID;
    v_existing public.accounts;
    v_new_account public.accounts;
    v_target_id UUID;
BEGIN
    -- 1. Strict Authentication Check: caller must be an authenticated user
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User must be authenticated to provision a personal borrowings account.'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Concurrency Control: Acquire transaction-level advisory lock per user
    -- Uses a dedicated application namespace integer and the hash of user_id to serialize
    -- concurrent provisioning requests for the same user within the current transaction.
    PERFORM pg_advisory_xact_lock(
        hashtext('laxmilens_provision_personal_borrowings')::integer,
        hashtext(v_user_id::text)::integer
    );

    -- 3. Idempotency Check (under lock): Return existing system account if already provisioned
    SELECT * INTO v_existing
    FROM public.accounts
    WHERE user_id = v_user_id
      AND system_tag = 'personal_borrowings'
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
        RETURN v_existing;
    END IF;

    -- 4. Authorized insert of new system account
    -- Executing within this SECURITY DEFINER function sets current_user to the function owner (postgres),
    -- which is verified by trg_enforce_account_system_identity.
    v_target_id := COALESCE(p_account_id, gen_random_uuid());

    INSERT INTO public.accounts (
        id,
        user_id,
        name,
        account_type,
        opening_balance_paise,
        currency,
        institution_name,
        color,
        icon,
        notes,
        system_tag,
        is_archived,
        version,
        created_at,
        updated_at
    ) VALUES (
        v_target_id,
        v_user_id,
        COALESCE(NULLIF(trim(p_name), ''), 'Personal Borrowings'),
        'other',
        0,
        COALESCE(NULLIF(trim(p_currency), ''), 'INR'),
        NULL,
        COALESCE(p_color, '#D6AD60'),
        COALESCE(p_icon, 'hand-coins'),
        COALESCE(p_notes, 'Aggregate liability account for personal borrowings'),
        'personal_borrowings',
        FALSE,
        1,
        now(),
        now()
    )
    RETURNING * INTO v_new_account;

    RETURN v_new_account;
END;
$$;

-- ------------------------------------------------------------------------------
-- SYSTEM ACCOUNT IDENTITY ENFORCEMENT TRIGGER (SECURITY INVOKER)
-- Enforces universal immutability of system_tag on UPDATE across all execution contexts.
-- On INSERT, direct unprivileged roles (current_user IN ('authenticated', 'anon'))
-- are strictly prohibited from assigning system_tag directly, ensuring creation
-- occurs solely through the authorized SECURITY DEFINER provisioning function.
-- Direct unprivileged roles are also prohibited from deleting system accounts.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_account_system_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
    -- 1. IMMUTABILITY ON UPDATE
    IF TG_OP = 'UPDATE' THEN
        -- System tag is completely immutable across all execution contexts: cannot be assigned, altered, or cleared after creation
        IF (NEW.system_tag IS DISTINCT FROM OLD.system_tag) THEN
            RAISE EXCEPTION 'Unauthorized: system_tag is immutable once an account is created and cannot be assigned, altered, or cleared.'
                USING ERRCODE = '42501';
        END IF;

        -- Protect financial classification of system accounts
        IF OLD.system_tag IS NOT NULL THEN
            IF NEW.account_type <> OLD.account_type THEN
                RAISE EXCEPTION 'Unauthorized: Cannot change account_type on system account %: system accounts must retain their designated type.',
                    OLD.id
                    USING ERRCODE = '42501';
            END IF;
            IF NEW.opening_balance_paise <> OLD.opening_balance_paise THEN
                RAISE EXCEPTION 'Unauthorized: Cannot modify opening_balance_paise on system account %: opening balance is immutable.',
                    OLD.id
                    USING ERRCODE = '42501';
            END IF;
        END IF;
    END IF;

    -- 2. IMMUTABILITY ON DELETE
    IF TG_OP = 'DELETE' THEN
        IF OLD.system_tag IS NOT NULL THEN
            IF current_user IN ('authenticated', 'anon') THEN
                RAISE EXCEPTION 'Unauthorized: System account % is permanent and cannot be deleted by role %.', OLD.id, current_user
                    USING ERRCODE = '42501';
            END IF;
        END IF;
        RETURN OLD;
    END IF;

    -- 3. PROVISIONING AUTHORIZATION & VALIDATION ON INSERT
    IF TG_OP = 'INSERT' THEN
        IF NEW.system_tag IS NOT NULL THEN
            -- Reject direct authenticated role assignment
            IF current_user IN ('authenticated', 'anon') THEN
                RAISE EXCEPTION 'Unauthorized: Ordinary database role % cannot assign system_tag directly. Use the authorized provisioning function.', current_user
                    USING ERRCODE = '42501';
            END IF;

            -- Strict system_tag whitelist
            IF NEW.system_tag <> 'personal_borrowings' THEN
                RAISE EXCEPTION 'Invalid system_tag: Only ''personal_borrowings'' is supported.'
                    USING ERRCODE = '22000';
            END IF;

            -- Strict liability account_type validation
            IF NEW.account_type <> 'other' THEN
                RAISE EXCEPTION 'Invalid account type: Personal Borrowings system account must have account_type ''other'', got ''%''.',
                    NEW.account_type
                    USING ERRCODE = '22000';
            END IF;

            -- Strict zero opening balance validation
            IF NEW.opening_balance_paise <> 0 THEN
                RAISE EXCEPTION 'Invalid opening balance: Personal Borrowings system account must have opening_balance_paise = 0, got %.',
                    NEW.opening_balance_paise
                    USING ERRCODE = '22000';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_account_system_identity ON public.accounts;
CREATE TRIGGER trg_enforce_account_system_identity
    BEFORE INSERT OR UPDATE OR DELETE ON public.accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_account_system_identity();

-- ------------------------------------------------------------------------------
-- 1. LENDERS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lenders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(30),
    email VARCHAR(255),
    notes TEXT,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lender_name_not_empty CHECK (length(trim(name)) > 0)
);

ALTER TABLE public.lenders ENABLE ROW LEVEL SECURITY;

-- Least-privilege RLS: Lenders can be viewed, created, and updated (e.g. renamed, archived).
-- Destructive DELETE is intentionally omitted to preserve financial ledger auditability.
CREATE POLICY "Users can view their own lenders"
    ON public.lenders FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own lenders"
    ON public.lenders FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own lenders"
    ON public.lenders FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Performance Indexes (Non-unique: two distinct lenders may legitimately share the same name)
CREATE INDEX IF NOT EXISTS idx_lenders_user_id ON public.lenders(user_id);
CREATE INDEX IF NOT EXISTS idx_lenders_user_name ON public.lenders(user_id, name);
CREATE INDEX IF NOT EXISTS idx_lenders_user_archived ON public.lenders(user_id, is_archived);

-- ------------------------------------------------------------------------------
-- 2. BORROWINGS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.borrowings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    lender_id UUID NOT NULL REFERENCES public.lenders(id) ON DELETE RESTRICT,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    borrowing_date TIMESTAMPTZ NOT NULL,
    due_date TIMESTAMPTZ,
    receiving_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
    transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'repaid')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Prevent the same transfer transaction from being linked to multiple borrowings
    CONSTRAINT unique_borrowing_transaction UNIQUE (transaction_id)
);

ALTER TABLE public.borrowings ENABLE ROW LEVEL SECURITY;

-- Least-privilege RLS: Borrowings can be viewed, created, and updated (e.g. status transition, metadata).
-- Destructive DELETE is intentionally omitted to maintain loan contract audit trails.
CREATE POLICY "Users can view their own borrowings"
    ON public.borrowings FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own borrowings"
    ON public.borrowings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own borrowings"
    ON public.borrowings FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Performance & Foreign Key Indexes
CREATE INDEX IF NOT EXISTS idx_borrowings_user_id ON public.borrowings(user_id);
CREATE INDEX IF NOT EXISTS idx_borrowings_user_lender ON public.borrowings(user_id, lender_id);
CREATE INDEX IF NOT EXISTS idx_borrowings_user_status ON public.borrowings(user_id, status);
CREATE INDEX IF NOT EXISTS idx_borrowings_date ON public.borrowings(user_id, borrowing_date DESC);
CREATE INDEX IF NOT EXISTS idx_borrowings_receiving_account ON public.borrowings(receiving_account_id);
CREATE INDEX IF NOT EXISTS idx_borrowings_transaction ON public.borrowings(transaction_id);

-- ------------------------------------------------------------------------------
-- 3. BORROWING REPAYMENTS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.borrowing_repayments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    borrowing_id UUID NOT NULL REFERENCES public.borrowings(id) ON DELETE RESTRICT,
    lender_id UUID NOT NULL REFERENCES public.lenders(id) ON DELETE RESTRICT,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    repayment_date TIMESTAMPTZ NOT NULL,
    payment_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
    transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Prevent the same repayment transaction from being linked to multiple repayment entries
    CONSTRAINT unique_repayment_transaction UNIQUE (transaction_id)
);

ALTER TABLE public.borrowing_repayments ENABLE ROW LEVEL SECURITY;

-- Least-privilege RLS: Repayments are append-only ledger logs.
-- UPDATE and DELETE policies are completely omitted to ensure absolute immutability.
CREATE POLICY "Users can view their own borrowing repayments"
    ON public.borrowing_repayments FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own borrowing repayments"
    ON public.borrowing_repayments FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Performance & Foreign Key Indexes
CREATE INDEX IF NOT EXISTS idx_repayments_user_id ON public.borrowing_repayments(user_id);
CREATE INDEX IF NOT EXISTS idx_repayments_borrowing_id ON public.borrowing_repayments(borrowing_id);
CREATE INDEX IF NOT EXISTS idx_repayments_user_lender ON public.borrowing_repayments(user_id, lender_id);
CREATE INDEX IF NOT EXISTS idx_repayments_payment_account ON public.borrowing_repayments(payment_account_id);
CREATE INDEX IF NOT EXISTS idx_repayments_transaction ON public.borrowing_repayments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_repayments_date ON public.borrowing_repayments(user_id, repayment_date DESC);

-- ------------------------------------------------------------------------------
-- 4. HARDENED BORROWING INTEGRITY TRIGGER
-- Validates lender, receiving account, and transaction ownership; verifies linked
-- transaction is a transfer from the designated Personal Borrowings liability account
-- to the receiving account matching the principal amount; enforces irreversible
-- settlement status (repaid cannot transition back to active).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_borrowing_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_lender_user_id UUID;
    v_receiving_acc_user_id UUID;
    v_tx_user_id UUID;
    v_tx_type VARCHAR(20);
    v_tx_amount BIGINT;
    v_tx_src_acc_id UUID;
    v_tx_dest_acc_id UUID;
    v_tx_deleted_at TIMESTAMPTZ;
    v_liability_acc_user_id UUID;
    v_liability_acc_system_tag VARCHAR(50);
    v_liability_acc_type VARCHAR(30);
    v_total_repaid BIGINT;
BEGIN
    -- 1. Verify lender belongs to the authenticated user
    SELECT user_id INTO v_lender_user_id
    FROM public.lenders
    WHERE id = NEW.lender_id;

    IF v_lender_user_id IS NULL OR v_lender_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Unauthorized: Referenced lender does not exist or does not belong to the user.'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Verify receiving account belongs to the user
    SELECT user_id INTO v_receiving_acc_user_id
    FROM public.accounts
    WHERE id = NEW.receiving_account_id;

    IF v_receiving_acc_user_id IS NULL OR v_receiving_acc_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Unauthorized: Referenced receiving account does not exist or does not belong to the user.'
            USING ERRCODE = '42501';
    END IF;

    -- 3. Verify transaction ownership, transfer type, amount, destination, liability source, and non-deletion
    SELECT user_id, type, amount_paise, account_id, destination_account_id, deleted_at
    INTO v_tx_user_id, v_tx_type, v_tx_amount, v_tx_src_acc_id, v_tx_dest_acc_id, v_tx_deleted_at
    FROM public.transactions
    WHERE id = NEW.transaction_id;

    IF v_tx_user_id IS NULL OR v_tx_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Unauthorized: Referenced transaction does not exist or does not belong to the user.'
            USING ERRCODE = '42501';
    END IF;

    IF v_tx_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid transaction: Linked transaction % has been soft-deleted.',
            NEW.transaction_id
            USING ERRCODE = '22000';
    END IF;

    IF v_tx_type <> 'transfer' THEN
        RAISE EXCEPTION 'Invalid transaction: Borrowing transfer transaction must be of type transfer, got %.',
            v_tx_type
            USING ERRCODE = '22000';
    END IF;

    IF v_tx_amount <> NEW.amount_paise THEN
        RAISE EXCEPTION 'Transaction amount mismatch: Transaction amount (%) does not match borrowing amount (%).',
            v_tx_amount, NEW.amount_paise
            USING ERRCODE = '22000';
    END IF;

    -- Verify source account is the user's designated Personal Borrowings liability account via durable system_tag
    SELECT user_id, system_tag, account_type
    INTO v_liability_acc_user_id, v_liability_acc_system_tag, v_liability_acc_type
    FROM public.accounts
    WHERE id = v_tx_src_acc_id;

    IF v_liability_acc_user_id IS NULL OR v_liability_acc_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Unauthorized: Transaction source account does not belong to the user.'
            USING ERRCODE = '42501';
    END IF;

    IF v_liability_acc_system_tag IS DISTINCT FROM 'personal_borrowings' OR v_liability_acc_type <> 'other' THEN
        RAISE EXCEPTION 'Invalid borrowing transaction: Source account % is not the user''s designated Personal Borrowings liability account (expected system_tag ''personal_borrowings'' and account_type ''other'').',
            v_tx_src_acc_id
            USING ERRCODE = '22000';
    END IF;

    -- Verify destination account is the specified receiving account
    IF v_tx_dest_acc_id IS NULL OR v_tx_dest_acc_id <> NEW.receiving_account_id THEN
        RAISE EXCEPTION 'Transaction account mismatch: Transaction destination account (%) does not match receiving account (%).',
            v_tx_dest_acc_id, NEW.receiving_account_id
            USING ERRCODE = '22000';
    END IF;

    -- 4. Enforce status transition constraints
    IF TG_OP = 'INSERT' AND NEW.status = 'repaid' THEN
        RAISE EXCEPTION 'A new borrowing cannot be initialized with status repaid.'
            USING ERRCODE = '22000';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Core financial terms cannot be mutated after contract creation
        IF NEW.user_id <> OLD.user_id THEN
            RAISE EXCEPTION 'Borrowing user_id is immutable.' USING ERRCODE = '42501';
        END IF;
        IF NEW.lender_id <> OLD.lender_id THEN
            RAISE EXCEPTION 'Borrowing lender_id is immutable.' USING ERRCODE = '22000';
        END IF;
        IF NEW.amount_paise <> OLD.amount_paise THEN
            RAISE EXCEPTION 'Borrowing amount_paise is immutable.' USING ERRCODE = '22000';
        END IF;
        IF NEW.receiving_account_id <> OLD.receiving_account_id THEN
            RAISE EXCEPTION 'Borrowing receiving_account_id is immutable.' USING ERRCODE = '22000';
        END IF;
        IF NEW.transaction_id <> OLD.transaction_id THEN
            RAISE EXCEPTION 'Borrowing transaction_id is immutable.' USING ERRCODE = '22000';
        END IF;
        IF NEW.borrowing_date <> OLD.borrowing_date THEN
            RAISE EXCEPTION 'Borrowing borrowing_date is immutable.' USING ERRCODE = '22000';
        END IF;

        -- Status Irreversibility: Once marked repaid, a borrowing cannot transition back to active
        IF OLD.status = 'repaid' AND NEW.status <> 'repaid' THEN
            RAISE EXCEPTION 'Illegal status transition: Borrowing % is already settled and cannot transition back to %.',
                NEW.id, NEW.status
                USING ERRCODE = '22000';
        END IF;

        -- Status cannot become 'repaid' unless settled repayments equal or exceed borrowed principal
        IF NEW.status = 'repaid' AND OLD.status <> 'repaid' THEN
            SELECT COALESCE(SUM(amount_paise), 0)
            INTO v_total_repaid
            FROM public.borrowing_repayments
            WHERE borrowing_id = NEW.id;

            IF v_total_repaid < NEW.amount_paise THEN
                RAISE EXCEPTION 'Borrowing % cannot be marked as repaid: total settled repayments (%) are less than borrowed principal (%).',
                    NEW.id, v_total_repaid, NEW.amount_paise
                    USING ERRCODE = '22000';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_borrowing_record ON public.borrowings;
CREATE TRIGGER trg_validate_borrowing_record
    BEFORE INSERT OR UPDATE ON public.borrowings
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_borrowing_record();

-- ------------------------------------------------------------------------------
-- 5. HARDENED REPAYMENT INTEGRITY & CONCURRENCY CONTROL TRIGGER
-- Enforces absolute immutability on UPDATE/DELETE, acquires row-level exclusive
-- lock (FOR UPDATE) on parent borrowing to serialize concurrent repayments,
-- verifies matching lender, payment account, linked transaction transfer to
-- Personal Borrowings liability account, and prevents repayments from exceeding
-- remaining principal.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_borrowing_repayment_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_borrowing_user_id UUID;
    v_borrowing_lender_id UUID;
    v_borrowing_amount_paise BIGINT;
    v_borrowing_status VARCHAR(20);
    v_payment_acc_user_id UUID;
    v_tx_user_id UUID;
    v_tx_type VARCHAR(20);
    v_tx_amount BIGINT;
    v_tx_src_acc_id UUID;
    v_tx_dest_acc_id UUID;
    v_tx_deleted_at TIMESTAMPTZ;
    v_liability_acc_user_id UUID;
    v_liability_acc_system_tag VARCHAR(50);
    v_liability_acc_type VARCHAR(30);
    v_total_already_repaid BIGINT;
BEGIN
    -- 1. Absolute Immutability: Repayment records are append-only ledger entries
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Repayment records are immutable and cannot be updated.'
            USING ERRCODE = '22000';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Repayment records are immutable and cannot be deleted.'
            USING ERRCODE = '22000';
    END IF;

    -- 2. Concurrency Control & Parent Borrowing Validation
    -- Acquire exclusive row-level lock on parent borrowing to serialize concurrent repayments
    SELECT user_id, lender_id, amount_paise, status
    INTO v_borrowing_user_id, v_borrowing_lender_id, v_borrowing_amount_paise, v_borrowing_status
    FROM public.borrowings
    WHERE id = NEW.borrowing_id
    FOR UPDATE;

    IF v_borrowing_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Referenced borrowing % does not exist.',
            NEW.borrowing_id
            USING ERRCODE = '23503';
    END IF;

    IF v_borrowing_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Unauthorized: Referenced borrowing does not belong to the user.'
            USING ERRCODE = '42501';
    END IF;

    -- 3. Verify repayment lender strictly matches parent borrowing's lender
    IF v_borrowing_lender_id <> NEW.lender_id THEN
        RAISE EXCEPTION 'Lender mismatch: Repayment lender (%) does not match borrowing lender (%).',
            NEW.lender_id, v_borrowing_lender_id
            USING ERRCODE = '22000';
    END IF;

    -- 4. Verify payment account belongs to the user
    SELECT user_id INTO v_payment_acc_user_id
    FROM public.accounts
    WHERE id = NEW.payment_account_id;

    IF v_payment_acc_user_id IS NULL OR v_payment_acc_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Unauthorized: Payment account does not exist or does not belong to the user.'
            USING ERRCODE = '42501';
    END IF;

    -- 5. Verify linked transaction ownership, transfer type, amount, source account, liability destination, and non-deletion
    SELECT user_id, type, amount_paise, account_id, destination_account_id, deleted_at
    INTO v_tx_user_id, v_tx_type, v_tx_amount, v_tx_src_acc_id, v_tx_dest_acc_id, v_tx_deleted_at
    FROM public.transactions
    WHERE id = NEW.transaction_id;

    IF v_tx_user_id IS NULL OR v_tx_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Unauthorized: Referenced transaction does not exist or does not belong to the user.'
            USING ERRCODE = '42501';
    END IF;

    IF v_tx_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid transaction: Linked transaction % has been soft-deleted.',
            NEW.transaction_id
            USING ERRCODE = '22000';
    END IF;

    IF v_tx_type <> 'transfer' THEN
        RAISE EXCEPTION 'Invalid transaction: Repayment transfer transaction must be of type transfer, got %.',
            v_tx_type
            USING ERRCODE = '22000';
    END IF;

    IF v_tx_amount <> NEW.amount_paise THEN
        RAISE EXCEPTION 'Transaction amount mismatch: Transaction amount (%) does not match repayment amount (%).',
            v_tx_amount, NEW.amount_paise
            USING ERRCODE = '22000';
    END IF;

    -- Verify source account matches the specified payment account
    IF v_tx_src_acc_id IS NULL OR v_tx_src_acc_id <> NEW.payment_account_id THEN
        RAISE EXCEPTION 'Transaction account mismatch: Transaction source account (%) does not match payment account (%).',
            v_tx_src_acc_id, NEW.payment_account_id
            USING ERRCODE = '22000';
    END IF;

    -- Verify destination account is the user's designated Personal Borrowings liability account via durable system_tag
    SELECT user_id, system_tag, account_type
    INTO v_liability_acc_user_id, v_liability_acc_system_tag, v_liability_acc_type
    FROM public.accounts
    WHERE id = v_tx_dest_acc_id;

    IF v_liability_acc_user_id IS NULL OR v_liability_acc_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Unauthorized: Transaction destination account does not belong to the user.'
            USING ERRCODE = '42501';
    END IF;

    IF v_liability_acc_system_tag IS DISTINCT FROM 'personal_borrowings' OR v_liability_acc_type <> 'other' THEN
        RAISE EXCEPTION 'Invalid repayment transaction: Destination account % is not the user''s designated Personal Borrowings liability account (expected system_tag ''personal_borrowings'' and account_type ''other'').',
            v_tx_dest_acc_id
            USING ERRCODE = '22000';
    END IF;

    -- 6. Enforce remaining principal: total repayments must not exceed principal
    SELECT COALESCE(SUM(amount_paise), 0)
    INTO v_total_already_repaid
    FROM public.borrowing_repayments
    WHERE borrowing_id = NEW.borrowing_id;

    IF v_total_already_repaid + NEW.amount_paise > v_borrowing_amount_paise THEN
        RAISE EXCEPTION 'Repayment amount (%) exceeds outstanding principal (%). Principal: %, Total previously repaid: %.',
            NEW.amount_paise,
            (v_borrowing_amount_paise - v_total_already_repaid),
            v_borrowing_amount_paise,
            v_total_already_repaid
            USING ERRCODE = '22000';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_borrowing_repayment_record ON public.borrowing_repayments;
CREATE TRIGGER trg_validate_borrowing_repayment_record
    BEFORE INSERT OR UPDATE OR DELETE ON public.borrowing_repayments
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_borrowing_repayment_record();

-- ------------------------------------------------------------------------------
-- 6. AUTOMATIC STATUS SYNCHRONIZATION TRIGGER
-- Automatically updates borrowing status to 'repaid' once cumulative repayments
-- settle 100% of the borrowed principal.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_borrowing_repaid_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_principal BIGINT;
    v_total_repaid BIGINT;
BEGIN
    SELECT amount_paise INTO v_principal
    FROM public.borrowings
    WHERE id = NEW.borrowing_id;

    SELECT COALESCE(SUM(amount_paise), 0) INTO v_total_repaid
    FROM public.borrowing_repayments
    WHERE borrowing_id = NEW.borrowing_id;

    IF v_total_repaid >= v_principal THEN
        UPDATE public.borrowings
        SET status = 'repaid', updated_at = now()
        WHERE id = NEW.borrowing_id AND status <> 'repaid';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_borrowing_repaid_status ON public.borrowing_repayments;
CREATE TRIGGER trg_sync_borrowing_repaid_status
    AFTER INSERT ON public.borrowing_repayments
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_borrowing_repaid_status();

-- ------------------------------------------------------------------------------
-- 7. PROTECT LINKED LEDGER TRANSACTIONS TRIGGER
-- Prevents soft-deleting or mutating financial terms (type, amount, source account,
-- destination account) on any transaction linked to a borrowing or repayment.
-- Non-linked transactions proceed completely unaffected.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_borrowing_linked_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_is_linked BOOLEAN := FALSE;
    v_link_type TEXT;
BEGIN
    -- Fast lookup: check if this transaction is linked to a borrowing or repayment
    IF EXISTS (SELECT 1 FROM public.borrowings WHERE transaction_id = OLD.id) THEN
        v_is_linked := TRUE;
        v_link_type := 'borrowing';
    ELSIF EXISTS (SELECT 1 FROM public.borrowing_repayments WHERE transaction_id = OLD.id) THEN
        v_is_linked := TRUE;
        v_link_type := 'borrowing repayment';
    END IF;

    -- Non-linked transactions proceed completely uninhibited
    IF NOT v_is_linked THEN
        RETURN NEW;
    END IF;

    -- If linked, protect immutable financial attributes and deletion lifecycle
    IF (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
        RAISE EXCEPTION 'Cannot modify deleted_at on transaction %: It is permanently linked to an active or settled % record.',
            OLD.id, v_link_type
            USING ERRCODE = '22000';
    END IF;

    IF NEW.type <> OLD.type THEN
        RAISE EXCEPTION 'Cannot alter transaction type on %: It is linked to a % record.',
            OLD.id, v_link_type
            USING ERRCODE = '22000';
    END IF;

    IF NEW.amount_paise <> OLD.amount_paise THEN
        RAISE EXCEPTION 'Cannot alter amount on transaction %: It is linked to a % record.',
            OLD.id, v_link_type
            USING ERRCODE = '22000';
    END IF;

    IF NEW.account_id <> OLD.account_id THEN
        RAISE EXCEPTION 'Cannot alter source account on transaction %: It is linked to a % record.',
            OLD.id, v_link_type
            USING ERRCODE = '22000';
    END IF;

    IF (NEW.destination_account_id IS DISTINCT FROM OLD.destination_account_id) THEN
        RAISE EXCEPTION 'Cannot alter destination account on transaction %: It is linked to a % record.',
            OLD.id, v_link_type
            USING ERRCODE = '22000';
    END IF;

    -- Non-financial metadata updates (e.g. title, note, version, device_id, updated_at) are permitted
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_borrowing_linked_transactions ON public.transactions;
CREATE TRIGGER trg_protect_borrowing_linked_transactions
    BEFORE UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_borrowing_linked_transactions();

-- ------------------------------------------------------------------------------
-- 8. LEAST-PRIVILEGE ROLE PERMISSIONS (GRANT / REVOKE)
-- ------------------------------------------------------------------------------
-- 1. Explicitly revoke all existing table privileges from anon, authenticated, and PUBLIC
REVOKE ALL ON TABLE public.lenders FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.borrowings FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.borrowing_repayments FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.borrowing_repayments FROM authenticated;

-- 2. Grant minimum required operation privileges to authenticated users
-- (DELETE and TRUNCATE are strictly prohibited on all financial borrowing tables)
GRANT SELECT, INSERT, UPDATE ON TABLE public.lenders TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.borrowings TO authenticated;
GRANT SELECT, INSERT ON TABLE public.borrowing_repayments TO authenticated;

-- 3. Explicitly revoke direct function execution privileges from PUBLIC, anon, and authenticated
-- (Triggers execute internally via database engine; revoking direct execution eliminates RPC attack surface)
REVOKE ALL ON FUNCTION public.validate_borrowing_record() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_borrowing_repayment_record() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_borrowing_repaid_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_borrowing_linked_transactions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_account_system_identity() FROM PUBLIC, anon, authenticated;

-- 4. Grant execution privilege on authorized system account provisioning function to authenticated users
REVOKE ALL ON FUNCTION public.provision_personal_borrowings_account(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_personal_borrowings_account(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT) TO authenticated;
