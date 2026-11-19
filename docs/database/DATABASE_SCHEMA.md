# Database Schema Specification: LaxmiLens

## 1. Overview & Financial Precision

LaxmiLens is an offline-first financial application with two database tiers:
1. **Cloud Source of Truth**: PostgreSQL running on Supabase with strict Row Level Security (RLS) and integrity triggers.
2. **Local Client Database**: Dexie (IndexedDB) running in the browser for 0ms latency and full offline operation.

### The Integer Subunit Rule
In both PostgreSQL and IndexedDB, all monetary values are stored as **integer paise** (`BIGINT` in PostgreSQL, safe integer `number` in JavaScript).
- ₹1.00 = `100` paise
- ₹1,250.75 = `125075` paise
- Floating-point types (`FLOAT`, `DOUBLE`, `REAL`, `NUMERIC` with decimals) are prohibited for transaction and account storage.

---

## 2. PostgreSQL Cloud Schema (Supabase)

### Table: `profiles`
User profile information and default operating currency.
```sql
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
```

### Table: `accounts`
Financial containers representing banks, cash, wallets, and credit cards.
```sql
CREATE TABLE public.accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    account_type VARCHAR(30) NOT NULL DEFAULT 'cash' CHECK (
        account_type IN ('cash', 'bank', 'savings', 'credit_card', 'wallet', 'other')
    ),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    opening_balance_paise BIGINT NOT NULL DEFAULT 0,
    institution_name VARCHAR(100),
    color VARCHAR(30),
    icon VARCHAR(50),
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
```

### Table: `categories`
User-customizable income and expense classification categories.
```sql
CREATE TABLE public.categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense')),
    icon VARCHAR(50) NOT NULL DEFAULT 'tag',
    color VARCHAR(30) NOT NULL DEFAULT '#D6AD60',
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT unique_user_category_name_type UNIQUE (user_id, name, type)
);
```

### Table: `transactions`
The foundational financial ledger recording incomes, expenses, and inter-account transfers.
```sql
CREATE TABLE public.transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
    destination_account_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    title VARCHAR(255) NOT NULL,
    note TEXT,
    transaction_date TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ,
    device_id VARCHAR(100),
    idempotency_key VARCHAR(100) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT check_transfer_accounts CHECK (
        (type = 'transfer' AND destination_account_id IS NOT NULL AND account_id <> destination_account_id) OR
        (type <> 'transfer' AND destination_account_id IS NULL)
    ),
    CONSTRAINT unique_user_idempotency_key UNIQUE (user_id, idempotency_key)
);
```

---

## 3. Database Indexes

```sql
CREATE INDEX idx_accounts_user ON public.accounts(user_id) WHERE NOT is_archived;
CREATE INDEX idx_categories_user_type ON public.categories(user_id, type) WHERE NOT is_archived;
CREATE INDEX idx_transactions_user_date ON public.transactions(user_id, transaction_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_account ON public.transactions(account_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_destination ON public.transactions(destination_account_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_category ON public.transactions(category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_idempotency ON public.transactions(user_id, idempotency_key);
```

---

## 4. Row Level Security (RLS) & Tenant Isolation

Row Level Security is enabled on all tables. Queries and mutations are strictly evaluated against `auth.uid() = user_id`.

```sql
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "accounts_select_own" ON public.accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "accounts_insert_own" ON public.accounts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "accounts_update_own" ON public.accounts FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "accounts_delete_own" ON public.accounts FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "categories_select_own" ON public.categories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "categories_insert_own" ON public.categories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "categories_update_own" ON public.categories FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "categories_delete_own" ON public.categories FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "transactions_select_own" ON public.transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "transactions_insert_own" ON public.transactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "transactions_update_own" ON public.transactions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "transactions_delete_own" ON public.transactions FOR DELETE USING (auth.uid() = user_id);
```

---

## 5. Integrity Triggers: Cross-Tenant Validation

RLS restricts which transaction rows a user can write, but an attacker could theoretically attempt to specify an `account_id`, `destination_account_id`, or `category_id` belonging to a different user. 

The `validate_transaction_ownership` trigger function prevents this cross-tenant reference attacks:

```sql
CREATE OR REPLACE FUNCTION public.validate_transaction_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Verify account ownership
    IF NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = NEW.account_id AND user_id = NEW.user_id
    ) THEN
        RAISE EXCEPTION 'Account % does not belong to user %', NEW.account_id, NEW.user_id;
    END IF;

    -- Verify destination account ownership for transfers
    IF NEW.destination_account_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.accounts WHERE id = NEW.destination_account_id AND user_id = NEW.user_id
        ) THEN
            RAISE EXCEPTION 'Destination account % does not belong to user %', NEW.destination_account_id, NEW.user_id;
        END IF;
    END IF;

    -- Verify category ownership if assigned
    IF NEW.category_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.categories WHERE id = NEW.category_id AND user_id = NEW.user_id
        ) THEN
            RAISE EXCEPTION 'Category % does not belong to user %', NEW.category_id, NEW.user_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_transaction_ownership
BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.validate_transaction_ownership();
```

---

## 6. Stored Procedure: Atomic Transfer (`record_transfer_atomic`)

Inter-account transfers are recorded as single atomic records. Both debit and credit sides are represented by one transaction record with source `account_id` and target `destination_account_id`.

```sql
CREATE OR REPLACE FUNCTION public.record_transfer_atomic(
    p_user_id UUID,
    p_source_account_id UUID,
    p_destination_account_id UUID,
    p_amount_paise BIGINT,
    p_title VARCHAR(255),
    p_transaction_date TIMESTAMPTZ,
    p_idempotency_key VARCHAR(100),
    p_category_id UUID DEFAULT NULL,
    p_note TEXT DEFAULT NULL,
    p_device_id VARCHAR(100) DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_transaction_id UUID;
    v_source_exists BOOLEAN;
    v_dest_exists BOOLEAN;
BEGIN
    IF p_amount_paise <= 0 THEN
        RAISE EXCEPTION 'Transfer amount must be positive';
    END IF;

    IF p_source_account_id = p_destination_account_id THEN
        RAISE EXCEPTION 'Source and destination accounts must be distinct';
    END IF;

    -- Verify account ownership
    SELECT EXISTS(SELECT 1 FROM public.accounts WHERE id = p_source_account_id AND user_id = p_user_id) INTO v_source_exists;
    SELECT EXISTS(SELECT 1 FROM public.accounts WHERE id = p_destination_account_id AND user_id = p_user_id) INTO v_dest_exists;

    IF NOT v_source_exists OR NOT v_dest_exists THEN
        RAISE EXCEPTION 'One or both accounts do not exist or belong to another user';
    END IF;

    -- Insert transfer transaction
    INSERT INTO public.transactions (
        user_id,
        account_id,
        destination_account_id,
        category_id,
        type,
        amount_paise,
        currency,
        title,
        note,
        transaction_date,
        device_id,
        idempotency_key,
        version
    ) VALUES (
        p_user_id,
        p_source_account_id,
        p_destination_account_id,
        p_category_id,
        'transfer',
        p_amount_paise,
        'INR',
        p_title,
        p_note,
        p_transaction_date,
        p_device_id,
        p_idempotency_key,
        1
    )
    ON CONFLICT (user_id, idempotency_key) DO UPDATE
        SET updated_at = timezone('utc', now())
    RETURNING id INTO v_transaction_id;

    RETURN v_transaction_id;
END;
$$;
```

---

## 7. Local Client Database: Dexie (IndexedDB)

The local client uses Dexie with non-destructive version migrations:

### Version 2 Schema
```typescript
this.version(2).stores({
    profiles: 'id, email, currency',
    accounts: 'id, userId, accountType, isArchived, [userId+isArchived]',
    categories: 'id, userId, type, isArchived, [userId+type]',
    transactions: 'id, userId, accountId, destinationAccountId, categoryId, type, transactionDate, deletedAt, idempotencyKey, [userId+transactionDate], [accountId+deletedAt]',
    syncOutbox: 'id, status, clientTimestamp, attempts, idempotencyKey',
    syncMetadata: 'key, lastSyncedAt'
}).upgrade(tx => {
    // Non-destructive v1 to v2 migration
    return tx.table('transactions').toCollection().modify(record => {
        if (record.amount_in_paise !== undefined && record.amountPaise === undefined) {
            record.amountPaise = record.amount_in_paise;
            delete record.amount_in_paise;
        }
        if (record.target_account_id !== undefined && record.destinationAccountId === undefined) {
            record.destinationAccountId = record.target_account_id;
            delete record.target_account_id;
        }
        if (record.description && !record.title) {
            record.title = record.description;
            delete record.description;
        }
        if (record.date && !record.transactionDate) {
            record.transactionDate = record.date;
            delete record.date;
        }
        if (record.is_deleted !== undefined && record.deletedAt === undefined) {
            record.deletedAt = record.is_deleted ? new Date().toISOString() : null;
            delete record.is_deleted;
        }
    });
});
```
