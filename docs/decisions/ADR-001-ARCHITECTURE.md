# ADR-001: Architectural Foundation & Offline-First Strategy

## Status
Accepted

## Context
LaxmiLens is a personal finance management Progressive Web Application (PWA) designed for single users on Windows desktop and Android mobile devices. Financial software demands absolute mathematical correctness, zero floating-point drift, atomic account-to-account transfers, and high operational reliability during intermittent or absent network connectivity.

We needed to establish:
1. The structural code organization principles.
2. The monetary calculation and storage strategy.
3. The offline persistence and synchronization architecture.
4. The visual styling and design system foundation.

---

## Decisions

### 1. Feature-Based Modular Architecture with Clean Architecture Boundaries
- **Decision**: Organize the code into `domain`, `application`, `infrastructure`, `features`, `components`, and `app`.
- **Rationale**:
  - The `domain` layer remains pure TypeScript with zero external UI or persistence dependencies.
  - The `application` layer defines use cases and ports (`SyncPort`, `StoragePort`, `LoggerPort`, `AuthPort`), ensuring high testability without running browser or cloud infrastructure.
  - Presentation (`features`, `components`, `app`) depends only on application use cases and domain value objects.

### 2. Strict Integer Paise Monetary Representation (`Money` Value Object)
- **Decision**: Represent all monetary figures in the database as integer paise (`BIGINT` in PostgreSQL, safe integer in TypeScript). Prohibit floating-point currency numbers.
- **Rationale**: Floating-point arithmetic in JavaScript suffers from precision issues (e.g., $0.1 + 0.2 = 0.30000000000000004$). Storing integer paise (1 INR = 100 paise) prevents rounding drift and ensures exact ledger balances.

### 3. Derived Ledger Balances
- **Decision**: Disallow direct mutable balance columns on accounts. Balances must be derived mathematically from opening balance + ledger transactions (`LedgerRules.calculateAccountBalance`).
- **Rationale**: Prevents data desynchronization between transaction history and account summary figures.

### 4. Dexie (IndexedDB) + Transactional Outbox for Offline-First Synchronization
- **Decision**: Use Dexie.js as the durable local store, backed by an Outbox table. Keep synchronization logic entirely outside React components in a dedicated `SyncEngine`.
- **Rationale**: TanStack Query is an in-memory cache, not durable storage. React component lifecycles are transient and must not manage network sync queues. The Transactional Outbox guarantees that every local write is queued for eventual cloud replication.

### 5. Obsidian Gold Design System Foundation
- **Decision**: Adopt a dark-first `#101010` palette with `#D6AD60` champagne gold accents, Manrope/Inter typography, and `font-tabular` numerals.
- **Rationale**: Provides high contrast, tactile sophistication, and alignment precision for financial tables and ledgers.

---

## Consequences

- **Positive**:
  - Predictable, highly testable code base with clear boundaries.
  - Complete immunity to floating-point monetary calculation bugs.
  - Robust offline support with atomic local writes.
  - Zero leakage of cloud service-role credentials.
- **Trade-offs**:
  - Requires explicit conversions between rupees and paise via the `Money` value object.
  - Requires maintaining DTO and domain entity mapping layers.
