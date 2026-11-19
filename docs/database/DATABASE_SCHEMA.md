# Database Schema Specification: LaxmiLens

## 1. Overview & Financial Precision

LaxmiLens maintains two database tiers:
1. **Cloud Database**: PostgreSQL hosted on Supabase.
2. **Local Client Database**: Dexie (IndexedDB) running in the browser.

### The Integer Subunit Rule
In both PostgreSQL and IndexedDB, all monetary values are stored as **integer paise** (`BIGINT` in PostgreSQL, `number` safe integer in JavaScript).

- ₹1.00 = `100` paise
- ₹1,500.50 = `150050` paise
- Floating-point types (`FLOAT`, `DOUBLE`, `REAL`, `NUMERIC` with decimals) are strictly avoided for transactional ledger storage.

---

## 2. PostgreSQL Cloud Schema (Supabase)

### Table: `accounts`
Stores financial accounts owned by authenticated users.
```sql
CREATE TABLE public.accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(30) NOT NULL CHECK (type IN ('cash', 'bank', 'upi', 'wallet', 'credit_card')),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    opening_balance_in_paise BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    color VARCHAR(30),
    icon VARCHAR(50),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
```

### Table: `categories`
Stores income and expense categorization.
```sql
CREATE TABLE public.categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense')),
    parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    icon VARCHAR(50),
    color VARCHAR(30),
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
```

### Table: `transactions`
The immutable ledger of financial transactions.
```sql
CREATE TABLE public.transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    amount_in_paise BIGINT NOT NULL CHECK (amount_in_paise > 0),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    target_account_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    date TIMESTAMPTZ NOT NULL,
    description TEXT NOT NULL,
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'cleared' CHECK (status IN ('cleared', 'pending', 'reconciled')),
    idempotency_key VARCHAR(100) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT check_transfer_accounts CHECK (
        (type = 'transfer' AND target_account_id IS NOT NULL AND account_id <> target_account_id) OR
        (type <> 'transfer' AND target_account_id IS NULL)
    ),
    CONSTRAINT unique_user_idempotency_key UNIQUE (user_id, idempotency_key)
);
```

### Table: `budgets`
Monthly category-level spending limits.
```sql
CREATE TABLE public.budgets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    period VARCHAR(7) NOT NULL, -- Format: YYYY-MM
    limit_in_paise BIGINT NOT NULL CHECK (limit_in_paise >= 0),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT unique_user_category_period UNIQUE (user_id, category_id, period)
);
```

### Table: `recurring_rules`
Defines template rules for recurring transactions.
```sql
CREATE TABLE public.recurring_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    amount_in_paise BIGINT NOT NULL CHECK (amount_in_paise > 0),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    target_account_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
    interval INT NOT NULL DEFAULT 1 CHECK (interval > 0),
    start_date DATE NOT NULL,
    end_date DATE,
    next_due_date DATE NOT NULL,
    last_generated_date DATE,
    requires_user_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
```

---

## 3. Local IndexedDB Schema (Dexie)

Database Name: `LaxmiLens_LocalDB` (Version 1)

| Table | Indexed Columns | Purpose |
| :--- | :--- | :--- |
| `accounts` | `id, type, status, version, createdAt` | Local cache of user accounts |
| `transactions` | `id, type, accountId, targetAccountId, categoryId, date, status, idempotencyKey, version, isDeleted, [accountId+date]` | Local transaction ledger |
| `categories` | `id, type, parentId, isSystem, version` | Expense/income categories |
| `budgets` | `id, categoryId, period, [categoryId+period], version` | Budget allocations |
| `recurringRules` | `id, frequency, isActive, nextDueDate, version` | Recurring template rules |
| `syncOutbox` | `++id, entity, entityId, operation, idempotencyKey, attempts, createdAt` | Durable offline mutation log |
| `syncMetadata` | `key, updatedAt` | High-water mark sync timestamps and conflicts |
