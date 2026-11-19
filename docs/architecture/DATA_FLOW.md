# Data Flow Architecture: LaxmiLens

## 1. Primary Write Path: Local-First Mutation

Every financial mutation follows a strictly ordered write path to ensure offline reliability and instant UI feedback.

```
[ User Submits Form ]
        │
        ▼
[ Presentation Hook ] ─── (Calls Use Case)
        │
        ▼
[ Application Use Case ]
        │ 1. Validate DTO & Invariants
        │ 2. Create Domain Entities (e.g. Transaction, Money)
        │ 3. Generate Idempotency Key (UUIDv4)
        │
        ├──────────────────────────────────────┐
        ▼ (Step A: Local Write)                ▼ (Step B: Enqueue Outbox)
[ DexieTransactionRepository ]        [ OutboxManager ]
        │                                      │
        ▼                                      ▼
[ IndexedDB 'transactions' ]          [ IndexedDB 'syncOutbox' ]
        │                                      │
        └──────────────────┬───────────────────┘
                           │ (Atomic Local Commit)
                           ▼
                 [ Return Success to UI ]
                           │
                           ▼
                 [ Background Sync Trigger ]
```

### Steps Explained:
1. **User Submits Action**: e.g., user inputs a transaction of ₹500 for Groceries.
2. **Use Case Execution**: `RecordTransactionUseCase` creates a `Money.fromPaise(50000)` instance and assigns a unique `idempotencyKey`.
3. **Local Write**: The transaction record is written to Dexie's `transactions` table.
4. **Outbox Enqueue**: In the same operation, an entry is written into Dexie's `syncOutbox` table with `status = 'pending'`, `attempts = 0`, and the serialized payload.
5. **Immediate UI Resolution**: The UI updates optimistically with 0ms network latency.
6. **Background Sync**: `SyncEngine` is notified to flush the outbox if the device is online.

---

## 2. Ledger Calculation & Derived Balances

Account balances are **derived values**, not mutable database fields.

```
                      [ Opening Balance ] (from Account entity)
                               │
                               ▼
                   [ Retrieve Ledger Entries ]
               (All non-deleted transactions for account)
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
[ + Income Amounts ]   [ - Expense Amounts ]  [ Transfers (+/-) ]
        │                      │                      │
        └──────────────────────┼──────────────────────┘
                               │
                               ▼
                   [ Current Derived Balance ]
```

- When the application needs to display an account balance, `GetAccountBalanceUseCase` executes `LedgerRules.calculateAccountBalance()`.
- This ensures absolute consistency: if an historical transaction is edited, all subsequent balances recalculate cleanly without manual reconciliation overhead.
- Cached summary records may be maintained for performance in future milestones, but the verified ledger remains the single local source of truth.

---

## 3. Cloud Read & Remote Hydration Flow

When an authenticated user connects on a new device or pulls remote updates:

1. `SyncEngine` queries Supabase PostgreSQL for records where `updated_at > last_synced_at`.
2. Remote records are validated via `TransactionMapper` into domain entities.
3. Records are merged into Dexie tables using version checks:
   - If `remote.version > local.version`: Remote update overwrites local record.
   - If `local` has pending outbox entries for the same ID: A conflict is flagged in `syncMetadata` for resolution.
4. UI queries observe the local database and re-render reactively.
