# Data Flow Architecture: LaxmiLens

## 1. Primary Write Path: Manual Transaction Creation Flow

Every manual transaction entry follows a clean, decoupled path from UI input to local persistence:

```
[ User Action: Enter Transaction Form ]
                    │
                    ▼
[ Presentation Component / Hook ]
                    │ (Submits TransactionDTO)
                    ▼
[ CreateTransactionUseCase ]
    │
    ├── 1. Validate Account Existence & Ownership (AccountRepository.findById)
    ├── 2. Validate Category Type & Ownership if assigned (CategoryRepository.findById)
    ├── 3. Construct Money Value Object (from integer paise or rupee conversion)
    ├── 4. Generate Idempotency Key (UUIDv4)
    ├── 5. Instantiate Domain Transaction Entity
    │       (Enforces invariants: amount > 0, accountId present, valid dates)
    │
    ├────────────────────────────────────────┬────────────────────────────────────────┐
    ▼ (Primary Step: Save to Ledger)         ▼ (Secondary Step: Stage Sync Outbox)    │
[ DexieTransactionRepository.save() ]    [ OutboxManager.enqueue() ]                  │
    │                                        │                                        │
    ▼                                        ▼                                        │
[ Dexie DB: 'transactions' Table ]       [ Dexie DB: 'syncOutbox' Table ]             │
    │                                        │                                        │
    └───────────────────┬────────────────────┘                                        │
                        │                                                             │
                        ▼ (Immediate Local Commit)                                    │
              [ Return Success to UI ]                                                │
                        │                                                             │
                        ▼                                                             │
              [ Invalidate TanStack Query Cache ]                                     │
                        │                                                             │
                        ▼                                                             ▼
              [ Reactive UI Re-render ]                              [ Background Sync Trigger ]
```

---

## 2. Inter-Account Transfer Flow (`ExecuteTransferUseCase`)

Transfers between two accounts owned by the same user are recorded atomically:

```
[ User Inputs: Source Account A, Target Account B, Amount ₹1,000 ]
                               │
                               ▼
                   [ ExecuteTransferUseCase ]
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
[ Account A Exists & Belongs to User ]   [ Account B Exists & Belongs to User ]
            │                                     │
            └──────────────────┬──────────────────┘
                               │
            [ Validate Source != Destination ]
                               │
            [ Create Domain Transaction Entity ]
            (type = 'transfer', accountId = A, destinationAccountId = B)
                               │
            [ DexieTransactionRepository.save() ]
            (Stores atomic transfer record in IndexedDB)
                               │
            [ Enqueue Outbox for Remote Sync ]
            (Triggers Supabase RPC record_transfer_atomic when online)
```

---

## 3. Derived Balance & Ledger Calculation Flow

Account balances are **derived mathematically** from the immutable transaction ledger, rather than read from a mutable balance column:

```
[ UI Component: Account Card / Balance Display ]
                        │
                        ▼
            [ GetAccountBalanceUseCase ]
                        │
                        ├─────────────────────────────────────────────────┐
                        ▼                                                 ▼
        [ AccountRepository.findById() ]            [ TransactionRepository.findByAccountId() ]
                        │                                                 │
            (Retrieves Account entity)                    (Fetches all non-deleted transactions)
                        │                                                 │
                        └───────────────────────┬─────────────────────────┘
                                                │
                                                ▼
                                    [ LedgerRules.calculateAccountBalance ]
                                                │
            ┌───────────────────────────────────┼───────────────────────────────────┐
            ▼                                   ▼                                   ▼
[ Inflows (+): Income txs &          [ Outflows (-): Expense txs &        [ Baseline (+): Opening balance ]
  Transfers where account is          Transfers where account is          (Paise from Account record)
  destinationAccountId ]              accountId ]                                   │
            │                                   │                                   │
            └───────────────────────────────────┼───────────────────────────────────┘
                                                │
                                                ▼
                                    [ Final Derived Balance (Money) ]
                                                │
                                                ▼
                                    [ Formatted Rupee Output (₹) ]
```

### Cash Flow Invariance:
- Inter-account transfers **never** count toward monthly income or expenses in cash flow calculations (`LedgerRules.calculateTotals`).
- Transfers only shift liquidity between accounts without changing overall net worth.
- Soft-deleted transactions (`deletedAt !== null`) are strictly excluded from ledger calculations.
