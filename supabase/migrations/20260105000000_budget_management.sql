-- ==============================================================================
-- Migration: 20260105000000_budget_management.sql
-- Description: Hardened Budget Management schema: public.budgets table, active
--              tombstone-aware partial unique index, Row Level Security policies,
--              least-privilege GRANT/REVOKE, cross-tenant and expense-category
--              validation, identity/ownership immutability, monotonic versioning,
--              and irreversible deletion tombstones.
-- Notice: Prepared version-controlled migration script. Not automatically executed.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. BUDGETS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
    period VARCHAR(7) NOT NULL,
    limit_paise BIGINT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT budgets_period_format CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT budgets_limit_paise_positive CHECK (limit_paise > 0),
    CONSTRAINT budgets_version_positive CHECK (version >= 1)
);

COMMENT ON TABLE public.budgets IS 'Monthly expense category spending budgets stored strictly in integer paise with tombstone soft-deletion.';
COMMENT ON COLUMN public.budgets.limit_paise IS 'Strictly positive budget limit in integer paise (1 INR = 100 paise).';
COMMENT ON COLUMN public.budgets.period IS 'Calendar month identifier formatted strictly as YYYY-MM.';
COMMENT ON COLUMN public.budgets.deleted_at IS 'Tombstone timestamp for deleted budgets; NULL indicates an active budget.';

-- ------------------------------------------------------------------------------
-- 2. INDEXES & PARTIAL ACTIVE UNIQUENESS
-- Guarantee at most one active (deleted_at IS NULL) budget per (user_id, category_id, period)
-- while allowing safe recreation after a prior budget is tombstoned.
-- ------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_active_user_category_period
    ON public.budgets(user_id, category_id, period)
    WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_budgets_user_id ON public.budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_budgets_user_period ON public.budgets(user_id, period)
    WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_budgets_category_id ON public.budgets(category_id);
CREATE INDEX IF NOT EXISTS idx_budgets_deleted_at ON public.budgets(deleted_at);

-- ------------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY POLICIES
-- Authenticated users may view, create, and update their own budgets.
-- Destructive SQL DELETE is omitted; deletion uses tombstone updates via deleted_at.
-- ------------------------------------------------------------------------------
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own budgets"
    ON public.budgets FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own budgets"
    ON public.budgets FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own budgets"
    ON public.budgets FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 4. SERVER-SIDE BUDGET INTEGRITY, CATEGORY OWNERSHIP & IMMUTABILITY TRIGGER
-- Enforces:
--   - Authenticated ownership independently of client-supplied user_id
--   - Referenced category existence, same-user ownership, and expense classification
--   - Immutable id, user_id, category_id, period, and created_at
--   - Irreversible deletion tombstones (deleted budgets cannot be reactivated or altered)
--   - Monotonic optimistic concurrency version progression (version = OLD.version + 1)
--   - Prohibition on direct physical DELETE by unprivileged client roles
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_budget_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_category_user_id UUID;
    v_category_type VARCHAR(20);
    v_calling_role TEXT;
BEGIN
    v_calling_role := current_setting('role', true);

    -- 1. Prohibit physical DELETE by unprivileged client roles (tombstones via UPDATE only)
    IF TG_OP = 'DELETE' THEN
        IF v_calling_role IN ('authenticated', 'anon') THEN
            RAISE EXCEPTION 'Unauthorized: Physical deletion of budget % is prohibited for role %. Use tombstone update (deleted_at).',
                OLD.id, v_calling_role
                USING ERRCODE = '42501';
        END IF;
        RETURN OLD;
    END IF;

    -- 2. Enforce authenticated ownership independently of client-supplied user_id
    IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Budget user_id is required.'
            USING ERRCODE = '42501';
    END IF;

    IF v_calling_role IN ('authenticated', 'anon') THEN
        IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'Unauthorized: Budget user_id % does not match authenticated user.',
                NEW.user_id
                USING ERRCODE = '42501';
        END IF;
    ELSIF auth.uid() IS NOT NULL AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized: Budget user_id % does not match authenticated user.',
            NEW.user_id
            USING ERRCODE = '42501';
    END IF;

    -- 3. INSERT validations
    IF TG_OP = 'INSERT' THEN
        IF NEW.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Invalid budget %: A new budget cannot be created with deleted_at already set.',
                NEW.id
                USING ERRCODE = '22000';
        END IF;

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
            RAISE EXCEPTION 'Unauthorized: Referenced category % does not belong to the user.',
                NEW.category_id
                USING ERRCODE = '42501';
        END IF;

        IF v_category_type <> 'expense' THEN
            RAISE EXCEPTION 'Category type mismatch: Budget category % must be of type expense, got %.',
                NEW.category_id, v_category_type
                USING ERRCODE = '22000';
        END IF;

        RETURN NEW;
    END IF;

    -- 4. UPDATE validations (identity immutability, tombstone irreversibility, version lock)
    IF TG_OP = 'UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id THEN
            RAISE EXCEPTION 'Budget id is immutable.'
                USING ERRCODE = '22000';
        END IF;

        IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
            RAISE EXCEPTION 'Unauthorized: Budget user_id is immutable.'
                USING ERRCODE = '42501';
        END IF;

        IF NEW.category_id IS DISTINCT FROM OLD.category_id THEN
            RAISE EXCEPTION 'Budget category_id is immutable.'
                USING ERRCODE = '22000';
        END IF;

        IF NEW.period IS DISTINCT FROM OLD.period THEN
            RAISE EXCEPTION 'Budget period is immutable.'
                USING ERRCODE = '22000';
        END IF;

        IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Budget created_at is immutable.'
                USING ERRCODE = '22000';
        END IF;

        -- Tombstoned budgets cannot be reactivated or mutated
        IF OLD.deleted_at IS NOT NULL THEN
            IF NEW.deleted_at IS NULL THEN
                RAISE EXCEPTION 'Illegal reactivation: Tombstoned budget % cannot be reactivated.',
                    OLD.id
                    USING ERRCODE = '22000';
            END IF;
            RAISE EXCEPTION 'Tombstoned budget % is immutable and cannot be updated.',
                OLD.id
                USING ERRCODE = '22000';
        END IF;

        -- Enforce monotonic optimistic concurrency version progression
        IF NEW.version <> OLD.version + 1 THEN
            RAISE EXCEPTION 'Version conflict on budget %: expected version %, got %.',
                OLD.id, (OLD.version + 1), NEW.version
                USING ERRCODE = '22000';
        END IF;

        -- Tombstone update must preserve the final financial limit
        IF NEW.deleted_at IS NOT NULL AND NEW.limit_paise <> OLD.limit_paise THEN
            RAISE EXCEPTION 'Cannot modify limit_paise while tombstoning budget %.',
                OLD.id
                USING ERRCODE = '22000';
        END IF;

        -- Verify category still belongs to user and remains an expense category
        SELECT user_id, type
        INTO v_category_user_id, v_category_type
        FROM public.categories
        WHERE id = NEW.category_id;

        IF v_category_user_id IS NULL OR v_category_user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Unauthorized: Referenced category % does not belong to the user.',
                NEW.category_id
                USING ERRCODE = '42501';
        END IF;

        IF v_category_type <> 'expense' THEN
            RAISE EXCEPTION 'Category type mismatch: Budget category % must be of type expense, got %.',
                NEW.category_id, v_category_type
                USING ERRCODE = '22000';
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.validate_budget_record() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_validate_budget_record ON public.budgets;
CREATE TRIGGER trg_validate_budget_record
    BEFORE INSERT OR UPDATE OR DELETE ON public.budgets
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_budget_record();

-- ------------------------------------------------------------------------------
-- 5. LEAST-PRIVILEGE ROLE PERMISSIONS (GRANT / REVOKE)
-- ------------------------------------------------------------------------------
REVOKE ALL ON TABLE public.budgets FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.budgets TO authenticated;

REVOKE ALL ON FUNCTION public.validate_budget_record() FROM PUBLIC, anon, authenticated;
