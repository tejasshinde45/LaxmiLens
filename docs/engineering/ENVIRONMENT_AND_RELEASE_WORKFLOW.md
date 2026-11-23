# LaxmiLens — Development & Deployment Workflow

**Document Version:** 2.0.0  
**Status:** Active Canonical Architecture Standard  
**Target Systems:** LaxmiLens Web PWA, Dexie Local IndexedDB, Supabase PostgreSQL (Main Project: `ujbbhvbtjfzsoalzmqve`)

---

## 1. Executive Summary & Core Principles

LaxmiLens is an offline-first personal financial management application with cryptographic data integrity constraints and optimistic concurrency. To balance high developer velocity with absolute preservation of financial ledger data, LaxmiLens connects local development directly to the main Supabase project using test/dummy user accounts and dummy financial records until the complete application is ready.

### Core Invariants

1. **Single Source of Truth:** A single GitHub repository and code branch hierarchy governs all code. Divergent environment branches are strictly forbidden.
2. **Main Project Direct Development:** Local development and testing connect to the main Supabase project (`ujbbhvbtjfzsoalzmqve`) using dummy/test financial records.
3. **Fail-Closed Environment Guards:** Application startup validates project references and formatting at compile and runtime. Any invalid project reference, placeholder credential, or non-HTTPS URL halts execution immediately.
4. **Offline-First & Local Partitioning:** Local persistence is powered by Dexie (IndexedDB) partitioned by authenticated user ID. Changes remain local in the Transactional Outbox until explicit, manual "Sync Now" is triggered.
5. **No Frontend Service Role:** The Supabase `service_role` key must never enter client bundles, environment files, or repository code.

---

## 2. Environment Architecture Matrix

| Property | Local Development (Default Dev) | Hosted Production |
| :--- | :--- | :--- |
| **Project Name** | `LaxmiLens` | `LaxmiLens` |
| **Project Reference** | `ujbbhvbtjfzsoalzmqve` | `ujbbhvbtjfzsoalzmqve` |
| **Database Host** | `db.ujbbhvbtjfzsoalzmqve.supabase.co` | `db.ujbbhvbtjfzsoalzmqve.supabase.co` |
| **Vite App Mode** | `development` | `production` |
| **Local Config File** | `.env.local` | Hosted Platform Secrets |
| **Vite Launch Script** | `npm run dev` | CDN / Static Host |
| **Permitted Mutations** | Dummy/test records, user-scoped ledger entries | End-User Ledger Data |

---

## 3. Configuration & Secret Management

### File Hierarchy & Git Tracking

```
LaxmiLens/
├── .env.example              # TRACKED: Sanitized template with dummy placeholders
├── .env                      # IGNORED: Fallback default values
├── .env.local                # IGNORED: Local developer configuration (Main project reference)
└── supabase/
    ├── config.toml           # TRACKED: Base Supabase CLI settings (project_id = "ujbbhvbtjfzsoalzmqve")
    └── .temp/                # IGNORED: Active CLI linking state (project-ref, pooler)
```

- **`.gitignore` Invariant:** `.env`, `.env.local`, `.env.*.local`, and `supabase/.temp/` are permanently ignored.
- **`.env.example` Invariant:** Must contain only documented variable keys and placeholder values. Real API keys or project references must never be committed.

### Automated Environment Validation (`src/config/env.ts`)

LaxmiLens implements a zero-trust startup validator:

1. **Main Project Reference Consistency:**  
   In `development` and `production`, the project reference extracted from `VITE_SUPABASE_URL` must match `ujbbhvbtjfzsoalzmqve` (or `localhost` for local Supabase emulator).
2. **Legacy Staging Project Lockout:**  
   Any attempt to connect to obsolete staging references (e.g., `vtnygwjcwbufsreswhjw`) is blocked with an explicit error.
3. **Placeholder Rejection:**  
   Values containing `your-project-id`, `placeholder`, `your-publishable-key`, or brackets are rejected on boot.
4. **Credential Confidentiality:**  
   Error messages strictly suppress token strings and log only the violated rule name.

---

## 4. Daily Development Workflow

### Standard Command

```bash
npm run dev
```

This launches Vite in standard development mode, loading configuration from `.env.local`. The application connects to `LaxmiLens` (`ujbbhvbtjfzsoalzmqve`).

### Offline-First Development

LaxmiLens stores accounts, transactions, and mutations locally in IndexedDB via Dexie before sending them to the cloud. Developers can build features, test UI flows, and inspect ledger balances entirely offline without triggering cloud sync. Mutations remain safely queued in `syncOutbox` until "Sync Now" is pressed.

---

## 5. Development & Testing Protocol

Before committing changes, developers execute the standard verification gate:

```bash
# 1. Run full test suite
npm test

# 2. Strict TypeScript type check
npm run typecheck

# 3. Production build verification
npm run build
```

---

## 6. Production Release Protocol

Every release must strictly satisfy the release gate:

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

### 5. Migration Review
Confirm all migration files in `supabase/migrations/` have been reviewed without syntax or semantic errors.

### 6. Environment Separation Audit
Verify that the production deployment environment (CI/CD pipeline or hosting platform settings) supplies the production credentials (`ujbbhvbtjfzsoalzmqve`) and sets `VITE_APP_ENV=production`.

### 7. Explicit Release Authorization
Deploy the exact Git commit SHA that passed all previous steps. Building from untracked working trees is prohibited.

---

## 7. Database Safety & Migration Governance

### Active Migration Chain Rules

1. **Sequential Timestamp Versioning:** Migration filenames follow `YYYYMMDDHHMMSS_description.sql`.
2. **Archived Migrations:** Legacy or superseded migrations reside in `supabase/archive/` and are never pushed to active databases.
3. **Immutability of Applied Migrations:** Once a migration has been deployed, it must never be modified or reordered. Subsequent changes require a new migration file.

### Remote Database Safety Rules

- **No Automated Push:** CI/CD pipelines must not automatically run `supabase db push` against production without an explicit human approval gate.
- **Mandatory Backup:** Before applying DDL changes involving constraints or column drops, create a manual backup via Supabase Dashboard -> Database -> Backups.
- **Never Run `db reset` on Remote:** The command `supabase db reset` drops all database schemas. It is strictly banned on remote targets.
- **CLI Target Verification:** Before executing CLI tasks, verify:
  ```bash
  npx supabase projects list
  ```
  Ensure the operator explicitly specifies `--remote=ujbbhvbtjfzsoalzmqve` and double-checks the target prompt.

---

## 8. Rollback Procedures

### Scenario A: Frontend Application Defect
If a bug occurs in client code without database schema changes:
1. Re-deploy the previous known-healthy Git commit in the hosting platform.
2. Because Dexie stores outbox entries locally with idempotency keys, clients rolling back will not duplicate or lose pending financial transactions.

### Scenario B: Database Migration Defect
If a newly pushed migration causes runtime errors:
1. **Do not run `db reset`.**
2. Author an additive forward-rollback migration (e.g., `YYYYMMDDHHMMSS_revert_previous_change.sql`) that safely drops the problematic constraint, trigger, or column.
3. Apply the revert migration.

---

## 9. Operational Summary & Verification Checklist

- [x] **Main Project Connected:** `ujbbhvbtjfzsoalzmqve` configured for local development and production.
- [x] **Local Secret Hygiene:** `.env.local` and `supabase/.temp/` gitignored.
- [x] **Startup Circuit Breaker:** `src/config/env.ts` active and covered by unit tests.
- [x] **Standard Dev Command:** `npm run dev` standard workflow.
- [x] **Canonical Documentation:** Preserved in `docs/engineering/ENVIRONMENT_AND_RELEASE_WORKFLOW.md`.
