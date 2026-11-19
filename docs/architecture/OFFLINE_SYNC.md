# Offline Synchronization Strategy: LaxmiLens

## 1. Architectural Philosophy

LaxmiLens treats offline capability as a first-class citizen, not an afterthought. The application operates with full fidelity without an active internet connection.

### Core Tenets:
1. **Durable Local Storage**: Dexie (IndexedDB) is the primary client datastore. React Query is strictly used for in-memory caching and component reactivity—it is **never** treated as durable storage.
2. **Transactional Outbox Pattern**: Every local state mutation generates an outbox log entry. All mutations intended for cloud replication are queued before being transmitted.
3. **Outside-React Architecture**: Synchronization coordination runs in a standalone `SyncEngine` service, completely isolated from React component lifecycles.
4. **Zero Sensitive Service Worker Caching**: Service worker Workbox caching is restricted strictly to static assets (`js`, `css`, `html`, fonts, icons). Sensitive financial API responses are explicitly excluded from service worker cache.
5. **Clear Security Realism**: IndexedDB is **not** automatically encrypted by the browser. Local device security relies on host OS encryption (BitLocker / Android File-Based Encryption) and screen lock. Future manual encrypted export features will require explicit user password derivation (Argon2id/AES-GCM).

---

## 2. The Transactional Outbox Pattern

```
┌────────────────────────────────────────────────────────┐
│                   LOCAL MUTATION                      │
│                                                        │
│  1. DB.transaction('rw', [transactions, syncOutbox])   │
│  2. Save Transaction entity to 'transactions'          │
│  3. Add OutboxRecord to 'syncOutbox'                   │
│  4. Commit Transaction Atomically                      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   SYNC ENGINE                          │
│                                                        │
│  1. Checks navigator.onLine & acquisition lock         │
│  2. Reads batch of OutboxRecords ordered by ID         │
│  3. Transmits records with idempotency_key to Supabase │
│  4. On HTTP 200/201: Removes item from 'syncOutbox'    │
│  5. On Network Failure: Increments attempt count       │
│     and schedules exponential backoff                  │
└────────────────────────────────────────────────────────┘
```

### Outbox Record Structure:
```typescript
interface LocalOutboxRecord {
  id?: number;
  entity: 'accounts' | 'transactions' | 'categories' | 'budgets' | 'recurring_rules';
  entityId: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: Record<string, unknown>;
  idempotencyKey: string; // UUIDv4
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  createdAt: string;
}
```

---

## 3. Idempotency & Conflict Resolution

### Idempotency Keys
- Every user action generates a unique UUIDv4 `idempotencyKey`.
- The cloud PostgreSQL database enforces a compound unique constraint:
  ```sql
  CONSTRAINT unique_user_idempotency_key UNIQUE (user_id, idempotency_key)
  ```
- If a network failure occurs after the cloud receives the write but before the client receives the acknowledgment, retrying the operation will result in a harmless idempotent 200 response rather than duplicate transactions.

### Conflict Detection & Resolution Strategy
- **Version Tracking**: Entities maintain an incremental `version: number` counter.
- **Last-Write-Wins (LWW) with Version Check**:
  - If a remote entity was updated and has `remote.version > local.version` without pending local outbox edits, the local record is updated automatically.
  - If an entity has both local pending outbox edits AND remote updates (concurrent edits on different devices), the conflict is logged in `syncMetadata` and surfaced to the user with side-by-side resolution options.

---

## 4. Exponential Backoff & Retry Policy

When network transmissions fail due to connectivity interruptions:
1. `attempt` counter is incremented.
2. Backoff delay is calculated:
   $$\text{delay} = \min(\text{initialDelay} \times 2^{\text{attempt}}, \text{maxDelay})$$
   - `initialDelay`: 1,000 ms (1 second)
   - `maxDelay`: 60,000 ms (1 minute)
3. After 5 failed attempts, the entry enters a paused state to prevent battery and network drain, and an alert is flagged in the sync status UI.

---

## 5. Sync Status Visibility

The PWA displays real-time synchronization state in the navigation bar:
- **Synced** (Green): All local outbox items successfully pushed; no pending mutations.
- **Syncing** (Gold spinner): Currently processing outbox or pulling remote diffs.
- **Pending (N)** (Gold/Orange): Device is offline or reconnecting, with $N$ mutations queued locally.
- **Offline**: Browser network indicator is offline; writes are queued locally.
- **Conflict / Error** (Red): Action required due to schema mismatch or concurrent conflicting edits.
