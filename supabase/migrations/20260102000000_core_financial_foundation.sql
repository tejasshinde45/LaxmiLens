-- ==============================================================================
-- Migration: 20260102000000_core_financial_foundation.sql
-- Description: Core financial schema: profiles, accounts, categories, transactions,
--              Row Level Security, cross-tenant isolation, atomic transfer RPC,
--              and automatic category seeding.
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. USER PROFILES TABLE
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- 3. FINANCIAL ACCOUNTS TABLE
CREATE TABLE IF NOT EXISTS public.accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    account_type VARCHAR(30) NOT NULL CHECK (
        account_type IN ('cash', 'bank', 'savings', 'credit_card', 'wallet', 'other')
    ),
    opening_balance_paise BIGINT NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    institution_name VARCHAR(100),
    color VARCHAR(30),
    icon VARCHAR(50),
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT account_name_not_empty CHECK (length(trim(name)) > 0)
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own accounts"
    ON public.accounts FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own accounts"
    ON public.accounts FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own accounts"
    ON public.accounts FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own accounts"
    ON public.accounts FOR DELETE
    USING (auth.uid() = user_id);

-- 4. TRANSACTION CATEGORIES TABLE
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense')),
    icon VARCHAR(50),
    color VARCHAR(30),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT category_name_not_empty CHECK (length(trim(name)) > 0)
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own categories"
    ON public.categories FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own categories"
    ON public.categories FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own categories"
    ON public.categories FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own categories"
    ON public.categories FOR DELETE
    USING (auth.uid() = user_id);

-- 5. TRANSACTIONS LEDGER TABLE
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    destination_account_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    note TEXT,
    transaction_date TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    device_id VARCHAR(100),
    idempotency_key VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

    -- Transfer structural rules
    CONSTRAINT check_transfer_accounts CHECK (
        (type = 'transfer' AND destination_account_id IS NOT NULL AND account_id <> destination_account_id) OR
        (type <> 'transfer' AND destination_account_id IS NULL)
    ),
    -- Idempotency per user
    CONSTRAINT unique_user_idempotency_key UNIQUE (user_id, idempotency_key),
    CONSTRAINT transaction_title_not_empty CHECK (length(trim(title)) > 0)
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own transactions"
    ON public.transactions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own transactions"
    ON public.transactions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transactions"
    ON public.transactions FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own transactions"
    ON public.transactions FOR DELETE
    USING (auth.uid() = user_id);

-- 6. STRICT CROSS-TENANT OWNERSHIP VERIFICATION TRIGGER
-- Ensures that transactions cannot reference accounts or categories belonging to other users.
CREATE OR REPLACE FUNCTION public.validate_transaction_ownership()
RETURNS TRIGGER AS $$
DECLARE
    source_acc_owner UUID;
    dest_acc_owner UUID;
    cat_owner UUID;
    cat_type VARCHAR(20);
BEGIN
    -- Verify source account belongs to the user
    SELECT user_id INTO source_acc_owner FROM public.accounts WHERE id = NEW.account_id;
    IF source_acc_owner IS NULL OR source_acc_owner <> NEW.user_id THEN
        RAISE EXCEPTION 'Unauthorized: Source account does not belong to the user.' USING ERRCODE = '42501';
    END IF;

    -- If transfer, verify destination account belongs to the user
    IF NEW.type = 'transfer' THEN
        SELECT user_id INTO dest_acc_owner FROM public.accounts WHERE id = NEW.destination_account_id;
        IF dest_acc_owner IS NULL OR dest_acc_owner <> NEW.user_id THEN
            RAISE EXCEPTION 'Unauthorized: Destination account does not belong to the user.' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- If category assigned, verify category belongs to the user and matches transaction type
    IF NEW.category_id IS NOT NULL THEN
        SELECT user_id, type INTO cat_owner, cat_type FROM public.categories WHERE id = NEW.category_id;
        IF cat_owner IS NULL OR cat_owner <> NEW.user_id THEN
            RAISE EXCEPTION 'Unauthorized: Category does not belong to the user.' USING ERRCODE = '42501';
        END IF;

        IF NEW.type IN ('income', 'expense') AND cat_type <> NEW.type THEN
            RAISE EXCEPTION 'Category type mismatch: Category "%" is of type "%" but transaction is "%"',
                NEW.category_id, cat_type, NEW.type USING ERRCODE = '22000';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_validate_transaction_ownership ON public.transactions;
CREATE TRIGGER trg_validate_transaction_ownership
    BEFORE INSERT OR UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_transaction_ownership();

-- 7. ATOMIC TRANSFER RPC FUNCTION
-- Executes double-entry account-to-account transfer in a single ACID operation.
CREATE OR REPLACE FUNCTION public.record_transfer_atomic(
    p_source_account_id UUID,
    p_destination_account_id UUID,
    p_amount_paise BIGINT,
    p_title TEXT,
    p_transaction_date TIMESTAMPTZ,
    p_idempotency_key TEXT,
    p_note TEXT DEFAULT NULL,
    p_device_id TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
    v_new_id UUID;
BEGIN
    -- Authenticate caller
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    IF p_amount_paise <= 0 THEN
        RAISE EXCEPTION 'Transfer amount must be strictly positive.' USING ERRCODE = '22000';
    END IF;

    IF p_source_account_id = p_destination_account_id THEN
        RAISE EXCEPTION 'Source and destination accounts must be distinct.' USING ERRCODE = '22000';
    END IF;

    -- Insert atomic transfer transaction record
    INSERT INTO public.transactions (
        user_id,
        type,
        amount_paise,
        account_id,
        destination_account_id,
        category_id,
        title,
        note,
        transaction_date,
        idempotency_key,
        device_id,
        version
    ) VALUES (
        v_user_id,
        'transfer',
        p_amount_paise,
        p_source_account_id,
        p_destination_account_id,
        NULL,
        p_title,
        p_note,
        p_transaction_date,
        p_idempotency_key,
        p_device_id,
        1
    )
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. DEFAULT CATEGORY SEEDING FUNCTION
CREATE OR REPLACE FUNCTION public.seed_default_categories_for_user(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.categories (user_id, name, type, icon, color, is_default, is_archived)
    VALUES
        -- Income categories
        (p_user_id, 'Salary & Wages', 'income', 'Briefcase', '#72B895', TRUE, FALSE),
        (p_user_id, 'Business Income', 'income', 'Building2', '#72B895', TRUE, FALSE),
        (p_user_id, 'Investments & Dividends', 'income', 'TrendingUp', '#72B895', TRUE, FALSE),
        (p_user_id, 'Freelance & Consulting', 'income', 'Laptop', '#72B895', TRUE, FALSE),
        (p_user_id, 'Gifts & Grants', 'income', 'Gift', '#72B895', TRUE, FALSE),
        (p_user_id, 'Other Income', 'income', 'PlusCircle', '#72B895', TRUE, FALSE),
        -- Expense categories
        (p_user_id, 'Groceries & Household', 'expense', 'ShoppingCart', '#D9827C', TRUE, FALSE),
        (p_user_id, 'Food & Dining Out', 'expense', 'Utensils', '#D9827C', TRUE, FALSE),
        (p_user_id, 'Rent & Housing', 'expense', 'Home', '#D9827C', TRUE, FALSE),
        (p_user_id, 'Utilities & Bills', 'expense', 'Zap', '#D9827C', TRUE, FALSE),
        (p_user_id, 'Transport & Fuel', 'expense', 'Car', '#D9827C', TRUE, FALSE),
        (p_user_id, 'Health & Medical', 'expense', 'Activity', '#D9827C', TRUE, FALSE),
        (p_user_id, 'Shopping & Apparel', 'expense', 'ShoppingBag', '#D9827C', TRUE, FALSE),
        (p_user_id, 'Entertainment & Leisure', 'expense', 'Film', '#D9827C', TRUE, FALSE),
        (p_user_id, 'Education & Courses', 'expense', 'BookOpen', '#D9827C', TRUE, FALSE),
        (p_user_id, 'Personal Care', 'expense', 'Smile', '#D9827C', TRUE, FALSE),
        (p_user_id, 'Other Expense', 'expense', 'MinusCircle', '#D9827C', TRUE, FALSE)
    ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. USER SIGNUP AUTOMATION TRIGGER
-- Creates profile row and seeds default categories on auth.users creation.
CREATE OR REPLACE FUNCTION public.handle_new_user_setup()
RETURNS TRIGGER AS $$
BEGIN
    -- 1. Create user profile
    INSERT INTO public.profiles (id, email, display_name, currency)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        'INR'
    ) ON CONFLICT (id) DO NOTHING;

    -- 2. Seed default categories
    PERFORM public.seed_default_categories_for_user(NEW.id);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user_setup();

-- 10. INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_accounts_user_archived ON public.accounts(user_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_categories_user_archived ON public.categories(user_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON public.transactions(user_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON public.transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_destination_account ON public.transactions(destination_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON public.transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_deleted_at ON public.transactions(deleted_at);
