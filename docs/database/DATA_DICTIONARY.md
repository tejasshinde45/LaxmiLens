# LaxmiLens Data Dictionary

## 1. Overview & General Standards

This data dictionary defines all entities, attributes, data types, nullability, constraints, default values, and business rules for the core financial data foundation of LaxmiLens.

### Representation Standards
- **Monetary Values**: Stored exclusively as integer **paise** (`BIGINT` in PostgreSQL, safe integer `number` in TypeScript). 1 INR = 100 paise. Floating-point values are prohibited.
  - Example: `₹1,250.75` $\rightarrow$ `125075`.
- **Identifiers**: Canonical UUIDv4 strings (lowercase with hyphens) across both local Dexie and cloud Supabase.
- **Timestamps**: Stored as UTC ISO 8601 strings with timezone (`TIMESTAMPTZ` in PostgreSQL, ISO 8601 string in TypeScript/Dexie, e.g., `2026-01-02T10:30:00.000Z`).
- **Enums**: Lowercase string literals enforced by SQL `CHECK` constraints and TypeScript string union types.
- **Soft Deletion**: Implemented via nullable timestamp fields (`deleted_at` / `deletedAt`). `NULL` means active; non-null timestamp indicates when the record was soft-deleted.

---

## 2. Table: `profiles`

Stores user profile settings, display metadata, and primary operating currency preferences.

| Column Name | Database Type | TypeScript Type | Nullable | Default | Description & Invariants |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `string` | No | `auth.uid()` | Primary key; matches Supabase `auth.users(id)`. |
| `email` | `VARCHAR(255)` | `string` | No | None | Primary email address associated with the user account. |
| `display_name` | `VARCHAR(100)` | `string` \| `null` | Yes | `NULL` | User-chosen display name or greeting name. |
| `currency` | `VARCHAR(3)` | `string` | No | `'INR'` | Primary ISO 4217 three-letter currency code (e.g. `'INR'`). |
| `created_at` | `TIMESTAMPTZ` | `string` | No | `timezone('utc', now())` | UTC creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `string` | No | `timezone('utc', now())` | UTC last updated timestamp; auto-updated on record changes. |

### Constraints & Indexes
- **Primary Key**: `PRIMARY KEY (id)` referencing `auth.users(id) ON DELETE CASCADE`.
- **Index**: `idx_profiles_currency ON profiles(currency)`.

---

## 3. Table: `accounts`

Represents financial containers (bank accounts, credit cards, cash, digital wallets) owned by a user.

| Column Name | Database Type | TypeScript Type | Nullable | Default | Description & Invariants |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `string` | No | `gen_random_uuid()` | Unique account identifier. |
| `user_id` | `UUID` | `string` | No | `auth.uid()` | Foreign key to `auth.users(id)`. Identifies the account owner. |
| `name` | `VARCHAR(100)` | `string` | No | None | Descriptive account name (e.g., 'HDFC Salary Account', 'Pocket Cash'). |
| `account_type` | `VARCHAR(30)` | `AccountType` | No | `'cash'` | Categorization: `'cash'`, `'bank'`, `'savings'`, `'credit_card'`, `'wallet'`, `'other'`. |
| `currency` | `VARCHAR(3)` | `string` | No | `'INR'` | ISO 4217 currency identifier. |
| `opening_balance_paise` | `BIGINT` | `number` | No | `0` | Initial baseline balance in integer paise when creating the account. Can be negative for existing credit card debt. |
| `institution_name` | `VARCHAR(100)` | `string` \| `null` | Yes | `NULL` | Optional banking or financial institution name (e.g., 'State Bank of India'). |
| `color` | `VARCHAR(30)` | `string` \| `null` | Yes | `NULL` | Hex color code or design token for UI representation. |
| `icon` | `VARCHAR(50)` | `string` \| `null` | Yes | `NULL` | Icon identifier (e.g. Lucide icon name) for UI visual representation. |
| `notes` | `TEXT` | `string` \| `null` | Yes | `NULL` | Optional user notes or annotations regarding account purposes, limits, or guidelines. |
| `is_archived` | `BOOLEAN` | `boolean` | No | `FALSE` | If `TRUE`, account is hidden from active entry forms but retained for historical ledger integrity. |
| `version` | `INT` | `number` | No | `1` | Monotonically increasing revision counter for optimistic concurrency and sync replication. |
| `created_at` | `TIMESTAMPTZ` | `string` | No | `timezone('utc', now())` | UTC creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `string` | No | `timezone('utc', now())` | UTC last updated timestamp. |

### Business Rules & Invariants
1. **Derived Balance**: Account balances are never stored as a mutable field. The current balance is derived as:
   $$\text{Balance} = \text{opening\_balance\_paise} + \sum \text{Incomes} - \sum \text{Expenses} - \sum \text{Transfers Out} + \sum \text{Transfers In}$$
2. **Archival**: Accounts with ledger transactions cannot be permanently deleted from the database; they are soft-archived via `is_archived = TRUE`.

---

## 4. Table: `categories`

Classifies cash inflow and outflow transactions into user-customizable categories.

| Column Name | Database Type | TypeScript Type | Nullable | Default | Description & Invariants |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `string` | No | `gen_random_uuid()` | Unique category identifier. |
| `user_id` | `UUID` | `string` | No | `auth.uid()` | Foreign key to `auth.users(id)`. Categories are user-scoped. |
| `name` | `VARCHAR(100)` | `string` | No | None | Category display name (e.g., 'Groceries', 'Salary', 'Investment Return'). |
| `type` | `VARCHAR(20)` | `CategoryType` | No | None | Flow direction: `'income'` or `'expense'`. Checked via SQL constraint. |
| `icon` | `VARCHAR(50)` | `string` | No | `'tag'` | Icon key identifier for UI badge display. |
| `color` | `VARCHAR(30)` | `string` | No | `'#D6AD60'` | UI hex color code or design token. |
| `is_default` | `BOOLEAN` | `boolean` | No | `FALSE` | `TRUE` if generated during user onboarding/seeding; `FALSE` if user-created. |
| `is_archived` | `BOOLEAN` | `boolean` | No | `FALSE` | If `TRUE`, hidden from active selection pickers while preserving historical transactions. |
| `version` | `INT` | `number` | No | `1` | Sync revision counter. |
| `created_at` | `TIMESTAMPTZ` | `string` | No | `timezone('utc', now())` | UTC creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `string` | No | `timezone('utc', now())` | UTC last updated timestamp. |

### Constraints & Indexes
- **Check Constraint**: `CHECK (type IN ('income', 'expense'))`.
- **Unique Constraint**: `UNIQUE (user_id, name, type)`.
- **Index**: `idx_categories_user_type ON categories(user_id, type) WHERE NOT is_archived`.

---

## 5. Table: `transactions`

The foundational ledger recording all financial movements (incomes, expenses, and inter-account transfers).

| Column Name | Database Type | TypeScript Type | Nullable | Default | Description & Invariants |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `string` | No | `gen_random_uuid()` | Unique transaction identifier. |
| `user_id` | `UUID` | `string` | No | `auth.uid()` | Foreign key to `auth.users(id)`. |
| `account_id` | `UUID` | `string` | No | None | Foreign key to `accounts(id)`. The primary affected account (source for transfer/expense, recipient for income). |
| `destination_account_id` | `UUID` | `string` \| `null` | Yes | `NULL` | Foreign key to `accounts(id)`. Target account receiving transferred funds. Must be `NULL` for income/expense. |
| `category_id` | `UUID` | `string` \| `null` | Yes | `NULL` | Foreign key to `categories(id)`. Optional for transfers, recommended for income/expense. |
| `type` | `VARCHAR(20)` | `TransactionType` | No | None | Transaction kind: `'income'`, `'expense'`, or `'transfer'`. |
| `amount_paise` | `BIGINT` | `number` | No | None | Monetary magnitude in integer paise. Must be strictly positive ($> 0$). |
| `currency` | `VARCHAR(3)` | `string` | No | `'INR'` | ISO 4217 currency code. |
| `title` | `VARCHAR(255)` | `string` | No | None | Concise transaction title or payee/payer description. |
| `note` | `TEXT` | `string` \| `null` | Yes | `NULL` | Optional extended user memo, receipt details, or context. |
| `transaction_date` | `TIMESTAMPTZ` | `string` | No | None | Official date and time when the financial event occurred. |
| `deleted_at` | `TIMESTAMPTZ` | `string` \| `null` | Yes | `NULL` | Soft deletion marker. `NULL` for active records; set to UTC timestamp upon deletion. |
| `device_id` | `VARCHAR(100)` | `string` \| `null` | Yes | `NULL` | Client device identifier where the transaction originated. |
| `idempotency_key` | `VARCHAR(100)` | `string` | No | None | Client-generated UUIDv4 preventing duplicate submission across retries and offline sync flushes. |
| `version` | `INT` | `number` | No | `1` | Optimistic concurrency revision counter. |
| `created_at` | `TIMESTAMPTZ` | `string` | No | `timezone('utc', now())` | UTC creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | `string` | No | `timezone('utc', now())` | UTC last updated timestamp. |

### Database Constraints & Invariants
1. **Amount Invariant**: `CHECK (amount_paise > 0)`. Zero or negative transaction records are prohibited at the schema level.
2. **Transfer Invariant**:
   ```sql
   CONSTRAINT check_transfer_accounts CHECK (
       (type = 'transfer' AND destination_account_id IS NOT NULL AND account_id <> destination_account_id) OR
       (type <> 'transfer' AND destination_account_id IS NULL)
   )
   ```
   An inter-account transfer must have a distinct `destination_account_id`. Non-transfer transactions must have `NULL` destination.
3. **Idempotency Guarantee**: `CONSTRAINT unique_user_idempotency_key UNIQUE (user_id, idempotency_key)`. Prevents duplicate insertions from offline network retries.
4. **Cross-Tenant Ownership Trigger**: `validate_transaction_ownership` verifies on every `INSERT` or `UPDATE` that `account_id`, `destination_account_id` (if present), and `category_id` (if present) are all owned by the same `user_id`. Attempting to link another user's account raises an exception.
5. **Soft Deletion Index**: Indexes on `transactions` filter on `WHERE deleted_at IS NULL` to ensure query performance when calculating active ledger balances.
