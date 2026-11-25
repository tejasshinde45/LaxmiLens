-- ==============================================================================
-- Migration: 20260106000000_category_identity_protection.sql
-- Description: Protects public.categories identity (id, user_id) and financial
--              classification (type) against mutation on UPDATE while preserving
--              category archiving (is_archived) and metadata edits.
-- Notice: Prepared version-controlled migration script. Not automatically executed.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.protect_category_identity_and_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    -- Prevent identity reassignment on existing category rows
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Category id is immutable and cannot be modified for %.',
            OLD.id
            USING ERRCODE = '23514';
    END IF;

    -- Prevent ownership transfer across all execution contexts (including privileged contexts)
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'Category user_id is immutable and cannot be changed on category %.',
            OLD.id
            USING ERRCODE = '23514';
    END IF;

    -- Prevent mutating financial classification (income <-> expense) once created,
    -- preserving integrity of historical transactions and active/past budgets
    IF NEW.type IS DISTINCT FROM OLD.type THEN
        RAISE EXCEPTION 'Category type is immutable on category %: cannot change from % to %.',
            OLD.id, OLD.type, NEW.type
            USING ERRCODE = '23514';
    END IF;

    -- Non-identifying metadata updates (including is_archived toggling, name, icon, color, version)
    -- proceed normally without interference.
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.protect_category_identity_and_type() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_protect_category_identity_and_type ON public.categories;
CREATE TRIGGER trg_protect_category_identity_and_type
    BEFORE UPDATE ON public.categories
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_category_identity_and_type();

REVOKE ALL ON FUNCTION public.protect_category_identity_and_type() FROM PUBLIC, anon, authenticated;
