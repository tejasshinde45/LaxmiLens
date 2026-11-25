-- ==============================================================================
-- Migration: 20260108000000_notifications.sql
-- Description: Notifications & Financial Alert Preferences schema:
--              public.notifications & public.notification_preferences tables,
--              user-scoped (user_id, dedupe_key) uniqueness, RLS policies,
--              least-privilege GRANT/REVOKE, fixed-search_path SECURITY DEFINER
--              validation triggers, Gregorian trigger_date validation, integer
--              metadata validation, monotonic category/severity/status locks,
--              immutable identity protections, and strict OCC version checks.
-- Notice: Prepared version-controlled migration script. Not automatically executed.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. NOTIFICATIONS TABLE
-- Deliberately omits foreign keys to financial tables (budgets, recurring_rules,
-- recurring_occurrences, transactions) so notification history never blocks
-- financial archive/delete lifecycles.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    category VARCHAR(40) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'unread',
    dedupe_key VARCHAR(255) NOT NULL,
    title VARCHAR(160) NOT NULL,
    message VARCHAR(500) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_id UUID NOT NULL,
    trigger_date VARCHAR(10) NOT NULL,
    action_route VARCHAR(255) NOT NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    read_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT notifications_category_check CHECK (
        category IN ('recurring_payment', 'budget_warning', 'budget_exceeded')
    ),
    CONSTRAINT notifications_severity_check CHECK (
        severity IN ('info', 'warning', 'critical')
    ),
    CONSTRAINT notifications_category_severity_check CHECK (
        (category = 'budget_warning' AND severity = 'warning')
        OR (category = 'budget_exceeded' AND severity = 'critical')
        OR (category = 'recurring_payment' AND severity IN ('info', 'warning', 'critical'))
    ),
    CONSTRAINT notifications_status_check CHECK (
        status IN ('unread', 'read', 'dismissed')
    ),
    CONSTRAINT notifications_dedupe_key_not_empty CHECK (
        length(trim(dedupe_key)) BETWEEN 1 AND 255
    ),
    CONSTRAINT notifications_title_not_empty CHECK (
        length(trim(title)) BETWEEN 1 AND 160
    ),
    CONSTRAINT notifications_message_not_empty CHECK (
        length(trim(message)) BETWEEN 1 AND 500
    ),
    CONSTRAINT notifications_entity_type_check CHECK (
        entity_type IN ('recurring_occurrence', 'recurring_rule', 'budget')
    ),
    CONSTRAINT notifications_trigger_date_format CHECK (
        trigger_date ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'
    ),
    CONSTRAINT notifications_action_route_safe CHECK (
        action_route = btrim(action_route)
        AND length(action_route) BETWEEN 1 AND 255
        AND left(action_route, 1) = '/'
        AND left(action_route, 2) <> '//'
        AND position('//' in action_route) = 0
        AND position(chr(92) in action_route) = 0
        AND position('://' in action_route) = 0
        AND position(':' in action_route) = 0
        AND position('..' in action_route) = 0
        AND action_route ~ '^(/$|/(budgets|recurring|dashboard|transactions|accounts|borrowings|analytics|calendar|reports|settings|notifications)([/?][a-zA-Z0-9/_=&%-]*)?$)'
    ),
    CONSTRAINT notifications_metadata_is_object CHECK (
        jsonb_typeof(metadata_json) = 'object'
    ),
    CONSTRAINT notifications_status_timestamp_coherence CHECK (
        (status = 'unread' AND read_at IS NULL AND dismissed_at IS NULL)
        OR (status = 'read' AND read_at IS NOT NULL AND dismissed_at IS NULL)
        OR (status = 'dismissed' AND dismissed_at IS NOT NULL)
    ),
    CONSTRAINT notifications_version_positive CHECK (version >= 1)
);

-- Enforce strictly one notification identity per (user_id, dedupe_key)
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe_key
    ON public.notifications(user_id, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
    ON public.notifications(user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_status
    ON public.notifications(user_id, status)
    WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_notifications_user_category
    ON public.notifications(user_id, category)
    WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_notifications_user_trigger_date
    ON public.notifications(user_id, trigger_date)
    WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_notifications_user_updated_at
    ON public.notifications(user_id, updated_at DESC)
    WHERE (deleted_at IS NULL);

-- ------------------------------------------------------------------------------
-- 2. NOTIFICATION PREFERENCES TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    recurring_payment_enabled BOOLEAN NOT NULL DEFAULT true,
    budget_warning_enabled BOOLEAN NOT NULL DEFAULT true,
    budget_exceeded_enabled BOOLEAN NOT NULL DEFAULT true,
    upcoming_lead_days INTEGER NOT NULL DEFAULT 3,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT notification_preferences_lead_days_range CHECK (
        upcoming_lead_days >= 0 AND upcoming_lead_days <= 30
    ),
    CONSTRAINT notification_preferences_version_positive CHECK (version >= 1)
);

-- ------------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY POLICIES & LEAST-PRIVILEGE GRANTS
-- ------------------------------------------------------------------------------
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications"
    ON public.notifications FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own notifications" ON public.notifications;
CREATE POLICY "Users can create their own notifications"
    ON public.notifications FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications"
    ON public.notifications FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can view their own notification preferences"
    ON public.notification_preferences FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can create their own notification preferences"
    ON public.notification_preferences FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can update their own notification preferences"
    ON public.notification_preferences FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON TABLE public.notifications FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.notifications TO authenticated;

REVOKE ALL ON TABLE public.notification_preferences FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.notification_preferences TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. SERVER-SIDE NOTIFICATION VALIDATION, IMMUTABILITY & MONOTONICITY TRIGGER
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_notification_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_calling_role TEXT;
    v_field TEXT;
    v_json_val JSONB;
    v_num NUMERIC;
    v_old_rank INTEGER;
    v_new_rank INTEGER;
BEGIN
    v_calling_role := COALESCE(NULLIF(NULLIF(current_setting('role', true), ''), 'none'), current_user);

    IF TG_OP = 'DELETE' THEN
        IF v_calling_role IN ('authenticated', 'anon') OR current_user IN ('authenticated', 'anon') THEN
            RAISE EXCEPTION 'Unauthorized: Physical deletion of notification % is prohibited for role %. Use tombstone update.',
                OLD.id, v_calling_role
                USING ERRCODE = '42501';
        END IF;
        RETURN OLD;
    END IF;

    IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Notification user_id is required.'
            USING ERRCODE = '42501';
    END IF;

    IF v_calling_role IN ('authenticated', 'anon') OR current_user IN ('authenticated', 'anon') THEN
        IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'Unauthorized: Notification user_id % does not match authenticated user.',
                NEW.user_id
                USING ERRCODE = '42501';
        END IF;
    ELSIF auth.uid() IS NOT NULL AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized: Notification user_id % does not match authenticated user.',
            NEW.user_id
            USING ERRCODE = '42501';
    END IF;

    -- Validate Gregorian calendar date (reject non-leap Feb 29, Apr 31, etc.)
    PERFORM public.assert_valid_gregorian_date(NEW.trigger_date, 'trigger_date');

    -- Validate integer metadata fields against domain rules
    IF jsonb_typeof(NEW.metadata_json) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Invalid notification % metadata_json: expected JSON object.',
            NEW.id
            USING ERRCODE = '22000';
    END IF;

    FOREACH v_field IN ARRAY ARRAY['amountPaise', 'limitPaise', 'spentPaise', 'utilizationPercentage'] LOOP
        IF NEW.metadata_json ? v_field THEN
            v_json_val := NEW.metadata_json -> v_field;
            IF jsonb_typeof(v_json_val) IS DISTINCT FROM 'number' THEN
                RAISE EXCEPTION 'Invalid notification % metadata field %: expected integer.',
                    NEW.id, v_field
                    USING ERRCODE = '22000';
            END IF;
            v_num := (v_json_val #>> '{}')::NUMERIC;
            IF trunc(v_num) <> v_num OR v_num < 0 OR v_num > 9007199254740991 THEN
                RAISE EXCEPTION 'Invalid notification % metadata field %: must be a non-negative safe integer (0..9007199254740991).',
                    NEW.id, v_field
                    USING ERRCODE = '22000';
            END IF;
        END IF;
    END LOOP;

    IF NEW.metadata_json ? 'daysUntilDue' THEN
        v_json_val := NEW.metadata_json -> 'daysUntilDue';
        IF jsonb_typeof(v_json_val) IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION 'Invalid notification % metadata field daysUntilDue: expected integer.',
                NEW.id
                USING ERRCODE = '22000';
        END IF;
        v_num := (v_json_val #>> '{}')::NUMERIC;
        IF trunc(v_num) <> v_num OR v_num < -9007199254740991 OR v_num > 9007199254740991 THEN
            RAISE EXCEPTION 'Invalid notification % metadata field daysUntilDue: must be a safe integer (-9007199254740991..9007199254740991).',
                NEW.id
                USING ERRCODE = '22000';
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Invalid notification %: Cannot create with deleted_at already set.',
                NEW.id
                USING ERRCODE = '22000';
        END IF;

        IF NEW.version <> 1 THEN
            RAISE EXCEPTION 'Invalid notification %: version must initialize to 1 on insert (got %).',
                NEW.id, NEW.version
                USING ERRCODE = '22000';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Identity fields and creation timestamp remain permanently immutable
        IF NEW.id IS DISTINCT FROM OLD.id OR
           NEW.user_id IS DISTINCT FROM OLD.user_id OR
           NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key OR
           NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Immutability violation on notification %: id, user_id, dedupe_key, and created_at are immutable.',
                OLD.id
                USING ERRCODE = '23514';
        END IF;

        IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
            RAISE EXCEPTION 'Illegal reactivation: Tombstoned notification % cannot be reactivated.',
                OLD.id
                USING ERRCODE = '23514';
        END IF;

        IF OLD.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Illegal modification: Tombstoned notification % cannot be altered.',
                OLD.id
                USING ERRCODE = '23514';
        END IF;

        IF NEW.deleted_at IS NOT NULL AND (
            NEW.category IS DISTINCT FROM OLD.category OR
            NEW.severity IS DISTINCT FROM OLD.severity OR
            NEW.status IS DISTINCT FROM OLD.status OR
            NEW.title IS DISTINCT FROM OLD.title OR
            NEW.message IS DISTINCT FROM OLD.message OR
            NEW.entity_type IS DISTINCT FROM OLD.entity_type OR
            NEW.entity_id IS DISTINCT FROM OLD.entity_id OR
            NEW.trigger_date IS DISTINCT FROM OLD.trigger_date OR
            NEW.action_route IS DISTINCT FROM OLD.action_route OR
            NEW.metadata_json IS DISTINCT FROM OLD.metadata_json OR
            NEW.read_at IS DISTINCT FROM OLD.read_at OR
            NEW.dismissed_at IS DISTINCT FROM OLD.dismissed_at
        ) THEN
            RAISE EXCEPTION 'Invalid tombstone on notification %: notification state cannot change during deletion.',
                OLD.id
                USING ERRCODE = '23514';
        END IF;

        -- Monotonic category progression check
        IF NOT (
            NEW.category = OLD.category
            OR (OLD.category = 'budget_warning' AND NEW.category = 'budget_exceeded')
        ) THEN
            RAISE EXCEPTION 'Illegal category transition on notification %: cannot change from % to %.',
                OLD.id, OLD.category, NEW.category
                USING ERRCODE = '23514';
        END IF;

        -- Monotonic severity progression check (info -> warning -> critical)
        v_old_rank := CASE OLD.severity
            WHEN 'info' THEN 1
            WHEN 'warning' THEN 2
            ELSE 3
        END;
        v_new_rank := CASE NEW.severity
            WHEN 'info' THEN 1
            WHEN 'warning' THEN 2
            ELSE 3
        END;
        IF v_new_rank < v_old_rank THEN
            RAISE EXCEPTION 'Severity downgrade prohibited on notification %: cannot transition from % to %.',
                OLD.id, OLD.severity, NEW.severity
                USING ERRCODE = '23514';
        END IF;

        -- Terminal and irreversible status checks + timestamp preservation
        IF OLD.status = 'dismissed' THEN
            IF NEW.status IS DISTINCT FROM 'dismissed' OR
               NEW.dismissed_at IS DISTINCT FROM OLD.dismissed_at OR
               NEW.read_at IS DISTINCT FROM OLD.read_at THEN
                RAISE EXCEPTION 'Illegal state transition on notification %: dismissed status and timestamps are locked.',
                    OLD.id
                    USING ERRCODE = '23514';
            END IF;
        ELSIF OLD.status = 'read' THEN
            IF NEW.status = 'unread' OR
               NEW.read_at IS DISTINCT FROM OLD.read_at THEN
                RAISE EXCEPTION 'Illegal state transition on notification %: read status cannot revert to unread and read_at is locked.',
                    OLD.id
                    USING ERRCODE = '23514';
            END IF;
        END IF;

        IF NEW.version <> OLD.version + 1 THEN
            RAISE EXCEPTION 'Concurrency conflict on notification %: expected version % but got %.',
                OLD.id, OLD.version + 1, NEW.version
                USING ERRCODE = '40001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.validate_notification_record() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_notification_record() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_notification_record ON public.notifications;
CREATE TRIGGER trg_validate_notification_record
    BEFORE INSERT OR UPDATE OR DELETE ON public.notifications
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_notification_record();

-- ------------------------------------------------------------------------------
-- 5. SERVER-SIDE NOTIFICATION PREFERENCES VALIDATION & OCC TRIGGER
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_notification_preference_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_calling_role TEXT;
BEGIN
    v_calling_role := COALESCE(NULLIF(NULLIF(current_setting('role', true), ''), 'none'), current_user);

    IF TG_OP = 'DELETE' THEN
        IF v_calling_role IN ('authenticated', 'anon') OR current_user IN ('authenticated', 'anon') THEN
            RAISE EXCEPTION 'Unauthorized: Physical deletion of notification preferences for user % is prohibited for role %.',
                OLD.user_id, v_calling_role
                USING ERRCODE = '42501';
        END IF;
        RETURN OLD;
    END IF;

    IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Notification preference user_id is required.'
            USING ERRCODE = '42501';
    END IF;

    IF v_calling_role IN ('authenticated', 'anon') OR current_user IN ('authenticated', 'anon') THEN
        IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'Unauthorized: Notification preference user_id % does not match authenticated user.',
                NEW.user_id
                USING ERRCODE = '42501';
        END IF;
    ELSIF auth.uid() IS NOT NULL AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized: Notification preference user_id % does not match authenticated user.',
            NEW.user_id
            USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.version <> 1 THEN
            RAISE EXCEPTION 'Invalid notification preferences for user %: version must initialize to 1 on insert (got %).',
                NEW.user_id, NEW.version
                USING ERRCODE = '22000';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.user_id IS DISTINCT FROM OLD.user_id OR
           NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Immutability violation on notification preferences for user %: user_id and created_at are immutable.',
                OLD.user_id
                USING ERRCODE = '23514';
        END IF;

        IF NEW.version <> OLD.version + 1 THEN
            RAISE EXCEPTION 'Concurrency conflict on notification preferences for user %: expected version % but got %.',
                OLD.user_id, OLD.version + 1, NEW.version
                USING ERRCODE = '40001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.validate_notification_preference_record() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_notification_preference_record() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_notification_preference_record ON public.notification_preferences;
CREATE TRIGGER trg_validate_notification_preference_record
    BEFORE INSERT OR UPDATE OR DELETE ON public.notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_notification_preference_record();
