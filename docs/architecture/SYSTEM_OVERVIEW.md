# System Overview: LaxmiLens Architecture

## 1. High-Level System Architecture

LaxmiLens is architected as an offline-first, client-centric Progressive Web Application. The application is designed to operate seamlessly whether the user is offline, on a spotty cellular connection, or connected to high-speed broadband.

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
│   RecordTransactionUseCase  │  ExecuteTransferUseCase                  │
│   GetAccountBalanceUseCase  │  CheckBudgetUseCase                      │
│   Ports: SyncPort, StoragePort, LoggerPort, AuthPort                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Coordinates Core Models
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                            DOMAIN LAYER                                │
│                                                                        │
│   Money (Integer Paise)     │  LedgerRules (Derived Balances)          │
│   Account, Transaction, Category, Budget, RecurringRule Entities       │
│   Repository Contracts: TransactionRepository, AccountRepository...    │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ Implements Contracts
                                    │
┌───────────────────────────────────┴────────────────────────────────────┐
│                       INFRASTRUCTURE LAYER                             │
│                                                                        │
│   Dexie (IndexedDB)             │   Transactional Outbox               │
│   Local Repositories            │   Background SyncEngine              │
│   Supabase Client (Cloud)       │   Console / Structured Logger        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS / WSS
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         SUPABASE CLOUD                                 │
│                                                                        │
│   PostgreSQL (BIGINT Paise)     │   Row Level Security (RLS)           │
│   Auth (Email & Google OAuth)   │   Cloud Source of Truth              │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Layer Responsibilities & Isolation Rules

### Presentation Layer (`src/app/`, `src/features/`, `src/components/`)
- Renders UI views and responds to user gestures.
- Uses TanStack Query hooks to observe local view-models.
- **Strict Rule**: UI components must never perform direct IndexedDB or Supabase SQL queries. All write operations invoke application use cases.

### Application Layer (`src/application/`)
- Encapsulates discrete user actions as use cases.
- Transforms raw input DTOs into domain value objects and entities.
- Interacts with abstract repository interfaces and ports (`SyncPort`, `StoragePort`, `LoggerPort`).
- Agnostic to whether persistence happens in IndexedDB, SQLite, or a cloud API.

### Domain Layer (`src/domain/`)
- Pure business logic and financial invariants.
- Contains the `Money` value object which enforces integer paise arithmetic and protects against floating-point inaccuracies.
- Contains `LedgerRules` which define derived account balance computation and double-entry atomic transfer rules.
- **Strict Rule**: Zero dependencies on UI frameworks, HTTP clients, or persistence libraries.

### Infrastructure Layer (`src/infrastructure/`)
- Implements the persistence contracts using Dexie for IndexedDB.
- Implements `SyncPort` using the `OutboxManager`.
- Manages the `SyncEngine` for cloud replication against Supabase PostgreSQL.
- Implements authentication via `SupabaseAuthAdapter`.

---

## 3. Technology Rationale

1. **Dexie (IndexedDB)**: Direct browser database access with high read/write performance and complete offline availability.
2. **Supabase PostgreSQL**: Industrial-grade relational database providing ACID transactions, strict schema constraints, and Row Level Security.
3. **Tailwind CSS v4**: High performance styling without bundle bloat, enabling strict design token mapping for Obsidian Gold.
4. **Zod**: Runtime validation at the application boundary for environment variables, DTOs, and sync payloads.
