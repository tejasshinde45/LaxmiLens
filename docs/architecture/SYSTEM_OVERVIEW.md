# System Overview: LaxmiLens Architecture

## 1. High-Level System Architecture

LaxmiLens is architected as an offline-first, client-centric Progressive Web Application (PWA). The application is designed to operate seamlessly whether the user is offline, on a spotty cellular connection, or connected to high-speed broadband.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PRESENTATION LAYER                              │
│                                                                        │
│   React 19 Components  │  Radix UI  │  Tailwind CSS v4 (Obsidian Gold)  │
│   React Router         │  TanStack Query (View-Model Cache Only)       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Invokes Use Cases
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         APPLICATION LAYER                              │
│                                                                        │
│   Accounts: CreateAccount, UpdateAccount, ArchiveAccount, GetBalance   │
│   Categories: CreateCategory                                           │
│   Transactions: CreateTransaction, UpdateTransaction, DeleteTransaction│
│                 GetTransactions, ExecuteTransfer, RecordTransaction    │
│   Ports: SyncPort, StoragePort, LoggerPort, AuthPort                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Coordinates Core Models
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                            DOMAIN LAYER                                │
│                                                                        │
│   Money (Integer Paise)     │  LedgerRules (Derived Balances)          │
│   Entities: Profile, Account, Category, Transaction                    │
│   Domain Errors: CategoryTypeMismatch, InvalidAmount, MissingAccount   │
│   Repository Contracts: ProfileRepo, AccountRepo, CategoryRepo, TxRepo │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ Implements Contracts
                                    │
┌───────────────────────────────────┴────────────────────────────────────┐
│                       INFRASTRUCTURE LAYER                             │
│                                                                        │
│   Dexie v2 (IndexedDB)          │   Transactional Outbox               │
│   Dexie Repositories (CRUD)     │   Background SyncEngine              │
│   Supabase Client (Cloud)       │   Console / Structured Logger        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS / WSS
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         SUPABASE CLOUD                                 │
│                                                                        │
│   PostgreSQL (BIGINT Paise)     │   Row Level Security (RLS)           │
│   Cross-Tenant Trigger Checks   │   Atomic Transfer RPC Function       │
│   Auth (Email & Google OAuth)   │   Cloud Source of Truth              │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Layer Responsibilities & Isolation Rules

### Presentation Layer (`src/app/`, `src/features/`, `src/components/`)
- Renders responsive UI views conforming to the Obsidian Gold design tokens.
- Uses TanStack Query hooks strictly for UI cache observation, not as persistent storage.
- **Strict Invariant**: UI components must never perform direct IndexedDB queries or Supabase SQL queries. All write operations invoke Application Use Cases.

### Application Layer (`src/application/`)
- Encapsulates user actions into single-responsibility Use Cases:
  - `CreateAccountUseCase`, `UpdateAccountUseCase`, `ArchiveAccountUseCase`, `GetAccountBalanceUseCase`.
  - `CreateCategoryUseCase`.
  - `CreateTransactionUseCase`, `UpdateTransactionUseCase`, `DeleteTransactionUseCase`, `GetTransactionsUseCase`, `ExecuteTransferUseCase`.
- Orchestrates input validation, domain rule execution, and repository persistence.
- Decoupled from persistent store mechanics; communicates via domain repository contracts.

### Domain Layer (`src/domain/`)
- Pure business logic, financial models, and invariants:
  - `Money`: Immutable value object enforcing integer paise arithmetic and zero floating-point drift.
  - `LedgerRules`: Pure domain functions computing derived balances ($\text{Opening} + \text{Income} - \text{Expenses} - \text{Transfers Out} + \text{Transfers In}$), cash flow totals, and net worth.
  - Entities: `Profile`, `Account`, `Category`, `Transaction` with domain invariants.
  - Domain Errors: `InvalidTransactionAmountError`, `CategoryTypeMismatchError`, `MissingAccountError`, `SelfTransferError`, `UnauthorizedEntityAccessError`.
- **Strict Invariant**: Zero imports from React, Dexie, Supabase, or browser APIs.

### Infrastructure Layer (`src/infrastructure/`)
- Implements domain repository interfaces (`DexieAccountRepository`, `DexieCategoryRepository`, `DexieTransactionRepository`, `DexieProfileRepository`).
- Manages Dexie schema upgrades (Version 1 $\rightarrow$ Version 2) non-destructively.
- Encapsulates cloud client access, remote mappers, and outbox synchronization.

---

## 3. Financial Data Integrity Principles

1. **Integer Paise Precision**: All currency quantities are stored as integer paise (`BIGINT` in database, integer `number` in JS). ₹1,250.75 is represented as `125075`.
2. **Derived Ledger Balances**: Account balances are derived from opening balances and ledger transactions. They are never independently edited.
3. **Soft-Deletion**: Transactions are soft-deleted via `deletedAt` timestamps. Soft-deleted transactions are excluded from active ledger balance calculations.
4. **Tenant Isolation**: Every database row references `user_id`. Supabase RLS enforces `auth.uid() = user_id`. PostgreSQL trigger `validate_transaction_ownership` validates that account, destination account, and category all belong to the user.
