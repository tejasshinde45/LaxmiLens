# Security Model & Architecture: LaxmiLens

## 1. Zero Service-Role Credential Policy

- **Strict Frontend Boundary**: The Supabase client is initialized exclusively using the public `VITE_SUPABASE_ANON_KEY`.
- **Prohibition of Service-Role Key**: Under no circumstances is the Supabase `service_role` secret ever committed to version control, embedded in `.env`, or imported into frontend bundles. The service-role key bypasses Row Level Security and must only exist in secure serverless backend environments if needed.

---

## 2. Row Level Security (RLS)

All tables in the Supabase PostgreSQL database have Row Level Security enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).

Every query, insert, update, and delete is governed by the user's authenticated JWT:
```sql
CREATE POLICY "Users can access their own transactions"
    ON public.transactions FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
```
- Direct table access is impossible for unauthenticated users.
- A user can never read, modify, or infer another user's financial ledger records.

---

## 3. Client Storage Security Realism

- **IndexedDB Is Unencrypted by Default**: Browsers store IndexedDB databases on the device filesystem without transparent application-level cryptographic encryption. LaxmiLens explicitly acknowledges this reality.
- **Physical Device Security Reliance**: Local security relies on the host operating system's device-level encryption:
  - Windows: BitLocker Drive Encryption.
  - Android: File-Based Encryption (FBE) + Screen lock credentials.
- **Service Worker Protection**: The Workbox service worker caching strategy (`vite.config.ts`) strictly caches static assets (`.js`, `.css`, `.png`, fonts). All API requests, Supabase endpoints, and auth routes are blocked from service worker caching (`navigateFallbackDenylist`).

---

## 4. Encrypted Data Export Policy (Future Milestone)

When manual backup exports are implemented in a future milestone:
1. Backups **must not** be exported as plaintext JSON.
2. The export payload must be encrypted client-side using industry-standard cryptography:
   - Key Derivation: **Argon2id** (or PBKDF2 with $\ge 600,000$ iterations) from a user-supplied backup password.
   - Symmetric Cipher: **AES-256-GCM** with a cryptographically secure random 96-bit initialization vector (IV) and authentication tag.
3. Plaintext financial records will never be written to unmanaged disk storage.

---

## 5. Environment & Secret Hygiene

- All environment variables are validated at build and runtime using Zod in `src/config/env.ts`.
- `.env` files are ignored in `.gitignore`.
- Dummy/placeholder values are provided in `.env.example` to prevent accidental credential leakage.
