# LaxmiLens — Hybrid Development & Deployment Workflow

**Document Version:** 1.0.0  
**Status:** Active Canonical Architecture Standard  
**Target Systems:** LaxmiLens Web PWA, Dexie Local IndexedDB, Supabase PostgreSQL (Staging & Production)

---

## 1. Executive Summary & Core Principles

LaxmiLens is an offline-first personal financial management application with cryptographic data integrity constraints and optimistic concurrency. To balance high developer velocity with absolute preservation of user financial ledger data, LaxmiLens enforces a **Hybrid Development & Deployment Workflow**.

### Core Invariants

1. **Single Source of Truth:** A single GitHub repository and code branch hierarchy governs all code. Divergent environment branches are strictly forbidden.
2. **Dual-Environment Cloud Isolation:** Local development and integration tests target the **Staging Supabase** project. The **Production Supabase** project receives only verified, approved release builds.
3. **Fail-Closed Environment Guards:** Application startup validates project references at compile and runtime. Any attempt by development code to contact production halts execution immediately.
4. **Zero Live Data Contamination:** Synthetic testing, stress testing, and sync regression tests are never performed on production ledgers.
5. **No Frontend Service Role:** The Supabase `service_role` key must never enter client bundles, environment files, or repository code.

---

## 2. Environment Architecture Matrix

| Property | Local Staging (Default Dev) | Local Production (Readiness Audit) | Hosted Production |
| :--- | :--- | :--- | :--- |
| **Project Name** | `LaxmiLens-Staging` | `LaxmiLens` | `LaxmiLens` |
| **Project Reference** | `vtnygwjcwbufsreswhjw` | `ujbbhvbtjfzsoalzmqve` | `ujbbhvbtjfzsoalzmqve` |
| **Database Host** | `db.vtnygwjcwbufsreswhjw.supabase.co` | `db.ujbbhvbtjfzsoalzmqve.supabase.co` | `db.ujbbhvbtjfzsoalzmqve.supabase.co` |
| **Vite App Mode** | `staging` | `production` | `production` |
| **Local Config File** | `.env.staging.local` | `.env.local` / `.env.production.local` | Hosted Platform Secrets |
| **Vite Launch Script** | `npm run dev:staging` | `npm run preview` (post-build) | CDN / Static Host |
| **Permitted Mutations** | Full (Create, reset, seed) | Read-only / Controlled Audit | End-User Ledger Data Only |

---

## 3. Configuration & Secret Management

### File Hierarchy & Git Tracking

```
LaxmiLens/
├── .env.example              # TRACKED: Sanitized template with dummy placeholders
├── .env                      # IGNORED: Fallback default values
├── .env.local                # IGNORED: Local developer configuration (Production reference)
├── .env.staging.local        # IGNORED: Local developer configuration (Staging reference)
└── supabase/
    ├── config.toml           # TRACKED: Base Supabase CLI settings
    └── .temp/                # IGNORED: Active CLI linking state (project-ref, pooler)
```

- **`.gitignore` Invariant:** `.env`, `.env.local`, `.env.staging.local`, `.env.*.local`, and `supabase/.temp/` are permanently ignored.
- **`.env.example` Invariant:** Must contain only documented variable keys and placeholder values (e.g., `https://<staging-project-ref>.supabase.co`). Real API keys or project references must never be committed.

### Automated Environment Validation (`src/config/env.ts`)

LaxmiLens implements a zero-trust startup validator:

1. **Development/Staging Production-Lockout Guard:**  
   If `VITE_APP_ENV` is `development` or `staging`, `VITE_SUPABASE_URL` is prohibited from containing the production reference `ujbbhvbtjfzsoalzmqve`.
2. **Production Staging-Lockout Guard:**  
   If `VITE_APP_ENV` is `production`, `VITE_SUPABASE_URL` is prohibited from containing the staging reference `vtnygwjcwbufsreswhjw`.
3. **Reference-URL Consistency Check:**  
   The project reference extracted from the URL subdomain must strictly match the declared mode (`vtnygwjcwbufsreswhjw` for staging, `ujbbhvbtjfzsoalzmqve` for production).
4. **Placeholder Rejection:**  
   Values containing `your-project-id`, `placeholder`, `your-publishable-key`, or brackets are rejected on boot.
5. **Credential Confidentiality:**  
   Error messages strictly suppress token strings and log only the violated rule name.

---

## 4. Daily Development Workflow

### Standard Command

```bash
npm run dev:staging
```

This launches Vite with `--mode staging`, instructing the runtime to load `.env.staging.local`. The application connects exclusively to `LaxmiLens-Staging` (`vtnygwjcwbufsreswhjw`).

### The `npm run dev` Safety Lock

If a developer executes `npm run dev` while `.env.local` retains production credentials (`ujbbhvbtjfzsoalzmqve`), the application will intentionally **fail to start** with:

```text
Environment validation failed: Development/staging environment must not connect to production Supabase project (ujbbhvbtjfzsoalzmqve). Please configure the staging project.
```

> [!IMPORTANT]
> This failure is intentional. It acts as an automated circuit breaker preventing local experiments from writing to production ledgers. For local work, always use `npm run dev:staging`.

### Offline-First Development

LaxmiLens stores accounts, transactions, and mutations locally in IndexedDB via Dexie before sending them to the cloud. Developers can build features, test UI flows, and inspect ledger balances entirely offline without triggering cloud sync. Mutations remain safely queued in `syncOutbox` until "Sync Now" is pressed.

---

## 5. Risk-Tiered Staging Validation Framework

Not all changes require staging database verification. Validation overhead is apportioned by risk:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CHANGE RISK CLASSIFICATION                      │
│                                                                        │
│   TIER 1: HIGH RISK (Mandatory Staging Verification)                   │
│   ├── Database Migrations (DDL, Constraints, Indexes)                  │
│   ├── Row Level Security (RLS) & Table Permissions                     │
│   ├── Auth Lifecycle (Triggers, Profile Hooks, Session Refresh)        │
│   ├── Financial Ledger Logic (Double-Entry, Versioning, Transfers)     │
│   └── Offline Sync Outbox & Conflict Resolution                        │
│                                                                        │
│   TIER 2: LOW RISK (Fast-Tracked — Unit & Build Tests Only)            │
│   ├── UI Component Styling & Layout Adjustments                        │
│   ├── Copy, Typography & Static Assets                                 │
│   └── Non-financial Client-Side Form Validations                       │
└────────────────────────────────────────────────────────────────────────┘
```

### Staging Verification Runbook (For Tier 1 Changes)

1. **Verify CLI Target:**
   ```bash
   npx supabase migration list --remote
   ```
   Confirm target is `LaxmiLens-Staging` (`vtnygwjcwbufsreswhjw`).
2. **Apply Pending Migrations (Dry-Run First):**
   ```bash
   npx supabase db push --dry-run --remote
   npx supabase db push --remote --yes
   ```
3. **Execute Local Staging App:**
   ```bash
   npm run dev:staging
   ```
4. **Functional Testing on Staging:**
   - Sign up with a disposable staging email (e.g., `dev+test1@laxmilens.internal`).
   - Confirm automatic profile generation and default category seeding.
   - Create accounts, record transactions, and perform transfers.
   - Click **Sync Now** and verify rows in Supabase Table Editor.
   - Verify outbox acknowledgement (local outbox empties on success).

---

## 6. Production Release Protocol

Every production release must strictly satisfy the **7-Step Release Gate**:

```
[1. Git Diff] ──► [2. npm test] ──► [3. typecheck] ──► [4. npm run build]
                                                              │
[7. Release Auth] ◄── [6. Env Audit] ◄── [5. Migration Review] ◄┘
```

### 1. Git Tree Cleanliness
Ensure no unstaged debug files, temporary credentials, or commented bypasses exist:
```bash
git status
git diff origin/master
```

### 2. Complete Test Suite Execution
All unit, integration, and synchronization tests must pass (100% success rate):
```bash
npm test
```

### 3. Strict TypeScript Typecheck
Zero type errors under strict compiler flags:
```bash
npm run typecheck
```

### 4. Production Build Verification
Verify production tree-shaking, minification, and service worker generation:
```bash
npm run build
```

### 5. Migration Review Against Staging
Confirm all migration files in `supabase/migrations/` have been verified on `LaxmiLens-Staging` without rollbacks or errors.

### 6. Environment Separation Audit
Verify that the production deployment environment (CI/CD pipeline or hosting platform settings) supplies the production credentials (`ujbbhvbtjfzsoalzmqve`) and sets `VITE_APP_ENV=production`.

### 7. Explicit Release Authorization
Deploy the exact Git commit SHA that passed all previous steps. Building from untracked working trees is prohibited.

---

## 7. Production Verification Runbook

Immediately following a production deployment:

1. **Smoke Test:** Load the production web application URL; verify bundle load, asset integrity, and service worker registration.
2. **Auth Verification:** Sign in with a designated operational administrative account. Verify active session persistence.
3. **Database Connectivity:** Verify existing financial accounts and balances load without RLS permission errors.
4. **Controlled Non-Destructive Ledger Test:**
   - Create a dedicated non-destructive test account (e.g., `Prod Smoke Account`).
   - Deposit a nominal verification balance (e.g., ₹10.00).
   - Perform a manual cloud synchronization via **Sync Now**.
   - Verify cloud persistence in Supabase table `accounts` with version 1.
   - Archive the smoke test account.
5. **Zero Data Loss Invariant:** Never modify, reassign, or delete existing user financial transactions or accounts.

---

## 8. Database Safety & Migration Governance

### Active Migration Chain Rules

1. **Sequential Timestamp Versioning:** Migration filenames follow `YYYYMMDDHHMMSS_description.sql`.
2. **Archived Migrations:** Legacy or superseded migrations reside in `supabase/archive/` and are never pushed to active databases.
3. **Immutability of Applied Migrations:** Once a migration has been deployed to production, it must never be modified or reordered. Subsequent changes require a new migration file.

### Production Migration Execution Rules

- **No Automated Push:** CI/CD pipelines must not automatically run `supabase db push` against production without an explicit human approval gate.
- **Mandatory Backup:** Before applying DDL changes involving constraints or column drops, create a manual backup via Supabase Dashboard -> Database -> Backups.
- **Never Run `db reset` on Production:** The command `supabase db reset` drops all database schemas. It is strictly banned on production targets.
- **CLI Target Verification:** Before executing production CLI tasks, verify:
  ```bash
  npx supabase projects list
  ```
  Ensure the operator explicitly specifies `--remote=ujbbhvbtjfzsoalzmqve` and double-checks the target prompt.

---

## 9. Rollback & Disaster Recovery Procedures

### Scenario A: Frontend Application Defect
If a bug occurs in client code without database schema changes:
1. Re-deploy the previous known-healthy Git commit in the hosting platform.
2. Because Dexie stores outbox entries locally with idempotency keys, clients rolling back will not duplicate or lose pending financial transactions.

### Scenario B: Database Migration Defect
If a newly pushed migration causes runtime errors:
1. **Do not run `db reset`.**
2. Author an additive forward-rollback migration (e.g., `YYYYMMDDHHMMSS_revert_previous_change.sql`) that safely drops the problematic constraint, trigger, or column.
3. Test the revert migration on `LaxmiLens-Staging`.
4. Apply the revert migration to production.

---

## 10. Operational Summary & Verification Checklist

- [x] **Staging Project Connected:** `vtnygwjcwbufsreswhjw` verified healthy and active.
- [x] **Production Project Isolated:** `ujbbhvbtjfzsoalzmqve` unlinked and guarded.
- [x] **Local Secret Hygiene:** `.env.staging.local` and `supabase/.temp/` gitignored.
- [x] **Startup Circuit Breaker:** `src/config/env.ts` active and covered by unit tests.
- [x] **Canonical Documentation:** Preserved in `docs/engineering/ENVIRONMENT_AND_RELEASE_WORKFLOW.md`.
