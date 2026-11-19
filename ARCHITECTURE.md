# LaxmiLens Architectural Specification

## 1. Architectural Style & Principles

LaxmiLens is an offline-first, single-user Personal Finance Management Progressive Web Application (PWA). It is engineered with a **Feature-Based Clean Architecture** to enforce separation of concerns, high maintainability, strict financial precision, and durable data integrity.

### Strict Dependency Direction

```
Presentation Layer (UI, Components, Features, App)
           │
           ▼
Application Layer (Use Cases, DTOs, Ports)
           │
           ▼
Domain Layer (Entities, Value Objects, Rules, Repository Interfaces)
           ▲
           │
Infrastructure Layer (Dexie, Supabase, Storage, Logger)
```

- **Domain Layer**: The innermost core. Contains pure TypeScript models, integer-paise `Money` value objects, ledger validation rules, domain errors, and abstract repository contracts. It contains **zero** imports from React, Dexie, Supabase, or browser APIs.
- **Application Layer**: Contains business use cases (`RecordTransactionUseCase`, `ExecuteTransferUseCase`, `GetAccountBalanceUseCase`), Data Transfer Objects (DTOs), and boundary ports (`SyncPort`, `StoragePort`, `LoggerPort`, `AuthPort`).
- **Infrastructure Layer**: Implements ports defined by the application/domain layers. Connects to Dexie (IndexedDB) for local persistence, Supabase (PostgreSQL) for cloud replication, and manages the Transactional Outbox.
- **Presentation Layer**: Built with React, Tailwind CSS v4 (Obsidian Gold theme), Radix UI primitives, Motion for React, and TanStack Query (used purely for view-model caching, never as durable offline storage).

---

## 2. Layer & Directory Layout

| Directory | Responsibility | Inward / Outward Boundary |
| :--- | :--- | :--- |
| `src/domain/` | Business rules, financial entities, `Money` value object, errors | Must not depend on any outer layers |
| `src/application/` | Use cases, DTOs, application interface ports | Depends strictly on Domain |
| `src/infrastructure/` | Local Dexie DB, Cloud Supabase client, Sync outbox engine, Logger | Implements Application and Domain ports |
| `src/features/` | Modular vertical slices (auth, transactions, accounts, budgets, etc.) | Uses Application use-cases and Shared UI |
| `src/components/` | Shared design-system components (`ui`, `forms`, `feedback`) | Presentation components |
| `src/app/` | Root app bootstrap, router, providers, layout shell | Top-level wiring |
| `src/config/` | Centralized Zod-validated environment config and app constants | Read-only configuration |
| `src/styles/` | Obsidian Gold CSS variables and Tailwind v4 theme tokens | Visual styling |

---

## 3. Financial Integrity Principles

1. **Integer Subunit Storage**: All financial transactions, balances, and budget thresholds are stored and processed strictly as integer **paise** (1 INR = 100 paise) via the `Money` value object and `BIGINT` columns in PostgreSQL. Floating-point numbers are prohibited in arithmetic calculations.
2. **Derived Ledger Balances**: Account balances are never independently modified or stored as isolated mutable numbers in the frontend. Balances are derived from `openingBalance + transactions` or verified ledger summaries.
3. **Atomic Transfers**: Account-to-account transfers are recorded as single transfer records with distinct `accountId` (source) and `targetAccountId` (destination). Both debits and credits occur atomically.
4. **Idempotent Synchronization**: Every financial mutation generates an immutable `idempotencyKey` (UUIDv4) stored locally and verified in cloud PostgreSQL via unique constraints.

---

## 4. Offline-First Resilience

```
[ User Interaction ]
        │
        ▼
[ Local Dexie DB ] <── (Immediate Persistence & Optimistic UI)
        │
        ▼
[ Transactional Outbox ]
        │
        ▼  (Background SyncEngine)
[ Cloud Supabase DB ]
```

- Local writes are committed to IndexedDB via Dexie before returning success to the user.
- Every mutating operation synchronously writes an event into the local `syncOutbox` table within the same transaction.
- When online, `SyncEngine` processes pending outbox operations sequentially with exponential backoff and idempotency verification.
