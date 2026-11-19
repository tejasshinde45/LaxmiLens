# LaxmiLens — Personal Finance Management System

An offline-first, single-user Progressive Web Application (PWA) designed for rigorous personal financial tracking, multi-account ledger balancing, and seamless cloud synchronization.

Built with **React 19**, **TypeScript**, **Tailwind CSS v4** (Obsidian Gold theme), **Dexie (IndexedDB)**, and **Supabase (PostgreSQL)**.

---

## Key Features

- **Offline-First Architecture**: Capture transactions instantly anywhere without internet access. Local persistence is powered by Dexie (IndexedDB) with a durable Transactional Outbox.
- **Financial Correctness**: Zero floating-point monetary errors. All currency amounts are stored and processed strictly as integer **paise** (1 INR = 100 paise) via the `Money` value object.
- **Derived Ledger Balances**: Account balances are derived mathematically from opening balances and ledger transactions, avoiding inconsistent mutable state.
- **Atomic Transfers**: Account-to-account transfers are recorded with atomic source debit and target credit effects.
- **Obsidian Gold Theme**: Premium dark theme (#101010) with champagne gold (#D6AD60) accents, high-contrast typography, and tabular figures for financial clarity.
- **Installable PWA**: Responsive on desktop (Windows) and mobile (Android) with standalone installation capabilities.

---

## Tech Stack

| Category | Technology |
| :--- | :--- |
| **Framework & Build** | React 19, TypeScript (Strict Mode), Vite 6 |
| **Styling & Design System** | Tailwind CSS v4, Radix UI primitives, Motion for React |
| **Icons & Feedback** | Lucide React, Sonner |
| **Local Persistence** | Dexie.js (IndexedDB wrapper) |
| **Cloud Database & Auth** | Supabase (PostgreSQL with Row Level Security) |
| **State & Querying** | TanStack Query v5 |
| **Forms & Validation** | React Hook Form, Zod |
| **Charts & Analytics** | Recharts |
| **PWA & Offline** | vite-plugin-pwa, Workbox |
| **Testing** | Vitest, React Testing Library, Playwright |

---

## Project Structure

```
src/
├── app/                  # Application bootstrap, routing, shell layout, navigation
├── components/           # Reusable UI primitives (buttons, inputs, cards, feedback)
├── features/             # Business feature modules (transactions, accounts, budgets, etc.)
├── domain/               # Pure financial models, Money VO, ledger rules, repository contracts
├── application/          # Use cases, DTOs, application boundary ports
├── infrastructure/       # Dexie local DB, Supabase cloud DB, SyncEngine, outbox manager
├── config/               # Zod-validated environment config and app constants
├── styles/               # Obsidian Gold theme and CSS variables
├── types/                # Shared utility types and branding
├── utils/                # Formatting and class merging helpers
└── test/                 # Test setup, factories, and mocks

supabase/                 # PostgreSQL migrations and RLS policies
tests/                    # Unit, integration, and E2E test suites
docs/                     # Architectural specifications and ADRs
```

---

## Getting Started

### Prerequisites

- Node.js >= 20 (recommended: Node 24)
- npm >= 10

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd LaxmiLens

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
```

### Development Scripts

```bash
# Start local Vite development server
npm run dev

# Run TypeScript type check
npm run typecheck

# Run unit and integration tests (Vitest)
npm run test

# Run tests in watch mode
npm run test:watch

# Build production bundle
npm run build

# Run Playwright E2E tests
npm run test:e2e
```

---

## Architectural Documentation

For deep technical insights, review the documentation in `docs/`:

- [System Overview](file:///d:/Download/Work/Personal/LaxmiLens/docs/architecture/SYSTEM_OVERVIEW.md)
- [Data Flow Architecture](file:///d:/Download/Work/Personal/LaxmiLens/docs/architecture/DATA_FLOW.md)
- [Offline Synchronization Strategy](file:///d:/Download/Work/Personal/LaxmiLens/docs/architecture/OFFLINE_SYNC.md)
- [PostgreSQL Database Schema](file:///d:/Download/Work/Personal/LaxmiLens/docs/database/DATABASE_SCHEMA.md)
- [Security Model & Guidelines](file:///d:/Download/Work/Personal/LaxmiLens/docs/security/SECURITY.md)
- [ADR-001: Architectural Foundation](file:///d:/Download/Work/Personal/LaxmiLens/docs/decisions/ADR-001-ARCHITECTURE.md)
