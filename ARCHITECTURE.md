# LaxmiLens Architectural Specification

## 1. Architectural Style & Principles

LaxmiLens is an offline-first, single-user Personal Finance Management Progressive Web Application (PWA). It is engineered with a **Feature-Based Clean Architecture** to enforce separation of concerns, high maintainability, strict financial precision, and durable data integrity.

### Strict Dependency Direction

```
Presentation Layer (UI, Components, Features, App, Auth Views & Guards)
           │
           ▼
Application Layer (Use Cases, DTOs, Ports: AuthPort, StoragePort)
           │
           ▼
Domain Layer (Entities, Value Objects, Rules, Repository Interfaces)
           ▲
           │
Infrastructure Layer (SupabaseAuthAdapter, Dexie, Supabase, Storage, Logger)
```

- **Domain Layer**: The innermost core. Contains pure TypeScript models, integer-paise `Money` value objects, ledger validation rules, domain errors, and abstract repository contracts. It contains **zero** imports from React, Dexie, Supabase, or browser APIs.
- **Application Layer**: Contains business use cases (`CreateAccount`, `UpdateAccount`, `ArchiveAccount`, `GetAccountBalance`, `CreateCategory`, `CreateTransaction`, `UpdateTransaction`, `DeleteTransaction`, `GetTransactions`, `ExecuteTransfer`), Data Transfer Objects (DTOs), and boundary ports (`AuthPort`, `SyncPort`, `StoragePort`, `LoggerPort`).
- **Infrastructure Layer**: Implements ports defined by the application/domain layers. Connects to `SupabaseAuthAdapter` for authentication and OAuth, Dexie v2 (IndexedDB) for local persistence, Supabase (PostgreSQL) for cloud replication, and manages the Transactional Outbox.
- **Presentation Layer**: Built with React 19, Tailwind CSS v4 (Obsidian Gold theme), Radix UI primitives, Motion for React, and TanStack Query (used purely for view-model caching, never as durable offline storage). Auth feature provides `AuthProvider`, `useAuth`, `ProtectedRoute`, `GuestRoute`, and obsidian-styled auth views (`LoginPage`, `RegisterPage`, `ForgotPasswordPage`, `ResetPasswordPage`, `AuthCallbackPage`).

---

## 2. Layer & Directory Layout

| Directory | Responsibility | Inward / Outward Boundary |
| :--- | :--- | :--- |
| `src/domain/` | Business rules, financial entities (`Profile`, `Account`, `Category`, `Transaction`), `Money` value object, errors | Must not depend on any outer layers |
| `src/application/` | Use cases, DTOs, application interface ports (`AuthPort`, `StoragePort`, etc.) | Depends strictly on Domain |
| `src/infrastructure/` | `SupabaseAuthAdapter`, Local Dexie DB (v2), Cloud Supabase client, Sync outbox engine, Repositories, Logger | Implements Application and Domain ports |
| `src/features/` | Modular vertical slices (`auth`, `transactions`, `accounts`, `budgets`, `dashboard`, etc.) | Uses Application use-cases and Shared UI |
| `src/components/` | Shared design-system components (`ui`, `forms`, `feedback`, `data-display`, `overlays`) | Presentation components |
| `src/app/` | Root app bootstrap, router, guards (`ProtectedRoute`, `GuestRoute`), providers, layout shell | Top-level wiring |
| `src/config/` | Centralized Zod-validated environment config and app constants | Read-only configuration |
| `src/styles/` | Obsidian Gold CSS variables and Tailwind v4 theme tokens | Visual styling |

---

## 3. Financial Integrity & Security Principles

1. **Integer Subunit Storage**: All financial transactions, balances, and opening balances are stored and processed strictly as integer **paise** (1 INR = 100 paise) via the `Money` value object and `BIGINT` columns in PostgreSQL. Floating-point numbers are prohibited in arithmetic calculations.
2. **Derived Ledger Balances**: Account balances are never independently modified or stored as isolated mutable numbers in the frontend. Balances are derived from `openingBalance + income - expenses - transfers_out + transfers_in`.
3. **Atomic Transfers**: Account-to-account transfers are recorded as single transfer records with distinct `accountId` (source) and `destinationAccountId` (destination). Both debits and credits occur atomically.
4. **Idempotent Synchronization**: Every financial mutation generates an immutable `idempotencyKey` (UUIDv4) stored locally and verified in cloud PostgreSQL via unique constraints.
5. **Cross-Tenant Isolation**: Enforced by Supabase Row Level Security (`auth.uid() = user_id`) and backed by PostgreSQL trigger `validate_transaction_ownership` ensuring source accounts, destination accounts, and categories all belong to the acting user.
6. **Authentication & Session Safety**: Managed via Supabase Auth. Route access is controlled by `ProtectedRoute` and `GuestRoute`. User changes clear in-memory TanStack query cache via `queryClient.clear()`.

---

## 4. Offline-First Resilience & Migrations

```
[ User Interaction ]
        │
        ▼
[ Local Dexie DB v2 ] <── (Immediate Persistence & Optimistic UI)
        │
        ▼
[ Transactional Outbox ]
        │
        ▼  (Background SyncEngine)
[ Cloud Supabase DB ]
```

- Local writes are committed to IndexedDB via Dexie before returning success to the user.
- Schema versioning via Dexie v2 provides automated, non-destructive migration for existing client databases.
- Every mutating operation synchronously stages an event into the local `syncOutbox` table within the same transaction.
- When online, `SyncEngine` processes pending outbox operations sequentially with exponential backoff and idempotency verification.
