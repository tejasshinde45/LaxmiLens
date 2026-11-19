# Security Model & Architecture: LaxmiLens

## 1. Zero Service-Role Credential Policy

- **Strict Frontend Boundary**: The Supabase client is initialized exclusively using the public `VITE_SUPABASE_ANON_KEY`.
- **Prohibition of Service-Role Key**: Under no circumstances is the Supabase `service_role` secret committed to version control, embedded in `.env`, or imported into frontend bundles. The service-role key bypasses Row Level Security and must only exist in secure serverless backend environments if needed.

---

## 2. Multi-Tenant Isolation & Row Level Security (RLS)

All tables in the Supabase PostgreSQL database have Row Level Security explicitly enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).

Every query, insert, update, and delete is strictly bound to the authenticated user's JWT identity:
```sql
CREATE POLICY "accounts_select_own" ON public.accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "transactions_select_own" ON public.transactions FOR SELECT USING (auth.uid() = user_id);
```
- Direct table access is rejected for unauthenticated users.
- A user can never read, modify, or query another user's financial records.

---

## 3. Defense Against Cross-Tenant Reference Attacks

Even with RLS filtering top-level rows, a malicious actor might craft an API request attempting to attach an `account_id`, `destination_account_id`, or `category_id` belonging to a different tenant into their own transaction.

To prevent this cross-tenant reference leakage, PostgreSQL triggers validate ownership on every write:

```sql
CREATE OR REPLACE FUNCTION public.validate_transaction_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Verify account ownership
    IF NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = NEW.account_id AND user_id = NEW.user_id
    ) THEN
        RAISE EXCEPTION 'Account % does not belong to user %', NEW.account_id, NEW.user_id;
    END IF;

    -- Verify destination account ownership for transfers
    IF NEW.destination_account_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.accounts WHERE id = NEW.destination_account_id AND user_id = NEW.user_id
        ) THEN
            RAISE EXCEPTION 'Destination account % does not belong to user %', NEW.destination_account_id, NEW.user_id;
        END IF;
    END IF;

    -- Verify category ownership if assigned
    IF NEW.category_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.categories WHERE id = NEW.category_id AND user_id = NEW.user_id
        ) THEN
            RAISE EXCEPTION 'Category % does not belong to user %', NEW.category_id, NEW.user_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
```

---

## 4. Safe Parameterization & Injection Defense

1. **Supabase PostgREST Client**: Queries use parameterized queries via the Supabase client SDK. Raw SQL concatenation is never performed in application code.
2. **Dexie Local Queries**: IndexedDB queries use Dexie's typed collection filters and index keys, precluding SQL injection vectors in the browser.
3. **Zod Validation**: All boundary inputs (DTOs, environment variables, form fields) are parsed and validated with Zod schemas prior to domain processing.

---

## 5. Client Storage Security Realism

- **IndexedDB Is Unencrypted by Default**: Browsers store IndexedDB databases on the device filesystem without transparent application-level cryptographic encryption. LaxmiLens explicitly acknowledges this reality.
- **Physical Device Security Reliance**: Local security relies on the host operating system's device-level encryption:
  - Windows: BitLocker Drive Encryption.
  - Android: File-Based Encryption (FBE) + Screen lock credentials.
- **Service Worker Protection**: The Workbox service worker caching strategy (`vite.config.ts`) strictly caches static assets (`.js`, `.css`, `.png`, fonts). All API requests, Supabase endpoints, and auth routes are blocked from service worker caching (`navigateFallbackDenylist`).

---

## 6. Encrypted Data Export Policy (Future Milestone)

When manual backup exports are implemented in a future milestone:
1. Backups **must not** be exported as plaintext JSON.
2. The export payload must be encrypted client-side using industry-standard cryptography:
   - Key Derivation: **Argon2id** (or PBKDF2 with $\ge 600,000$ iterations) from a user-supplied backup password.
   - Symmetric Cipher: **AES-256-GCM** with a cryptographically secure random 96-bit initialization vector (IV) and authentication tag.
3. Plaintext financial records will never be written to unmanaged disk storage.
