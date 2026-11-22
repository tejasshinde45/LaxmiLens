# Security Model & Architecture: LaxmiLens

## 1. Zero Service-Role Credential Policy

- **Strict Frontend Boundary**: The Supabase client is initialized exclusively using the public `VITE_SUPABASE_ANON_KEY` (or `VITE_SUPABASE_PUBLISHABLE_KEY`).
- **Prohibition of Service-Role Key**: Under no circumstances is the Supabase `service_role` secret committed to version control, embedded in `.env`, or imported into frontend bundles. The service-role key bypasses Row Level Security and must only exist in secure serverless backend environments if needed.

---

## 2. Authentication Architecture & Session Management

LaxmiLens uses **Supabase Auth** as its identity and authentication provider.

```
┌────────────────────────────────────────────────────────┐
│                   PRESENTATION                         │
│  LoginPage / RegisterPage / ForgotPass / ResetPass     │
│  ProtectedRoute / GuestRoute / AuthCallbackPage        │
└───────────────────────────┬────────────────────────────┘
                            │ useAuth()
                            ▼
┌────────────────────────────────────────────────────────┐
│               AUTH CONTEXT & PROVIDER                  │
│  State: user, isAuthenticated, isLoading               │
│  Actions: signIn, signUp, signInWithGoogle, signOut    │
│  Lifecycle: onAuthStateChange, cache flush on switch   │
└───────────────────────────┬────────────────────────────┘
                            │ AuthPort interface
                            ▼
┌────────────────────────────────────────────────────────┐
│            INFRASTRUCTURE / ADAPTER                    │
│  SupabaseAuthAdapter (implements AuthPort)             │
│  Error sanitization & mapping                          │
│  supabase.auth (GoTrue Client)                         │
└───────────────────────────┬────────────────────────────┘
                            │ WSS / HTTPS
                            ▼
┌────────────────────────────────────────────────────────┐
│                 SUPABASE AUTH (GoTrue)                 │
│  JWT Issuance, Refresh Tokens, Google OAuth Broker     │
│  Triggers on auth.users -> public.profiles             │
└────────────────────────────────────────────────────────┘
```

### Session Lifecycle & Security Principles
1. **Persistent Sessions**: Tokens are stored using Supabase's secure browser session storage with automatic JWT token refresh (`autoRefreshToken: true`).
2. **Restoration on Startup**: `AuthProvider` restores the session via `authAdapter.getCurrentUser()` on application load.
3. **No Unprotected Rendering**: Protected views are never rendered before initial session resolution. An Obsidian Gold loading screen (`AuthLoadingScreen`) protects routes during initialization.
4. **Cache Flushing on User Switch**: When switching accounts or signing out, `queryClient.clear()` is immediately executed to ensure no cached in-memory financial queries from the previous user remain accessible.
5. **No Token Storage in Custom LocalStorage**: We never store plain passwords, access tokens, or refresh tokens in custom localStorage keys. Supabase's native session manager manages storage securely.

---

## 3. Google OAuth 2.0 Integration & Setup Guide

Google OAuth operates through Supabase Auth using the standard PKCE / OAuth authorization code flow.

### External Configuration Checklist

To enable Google sign-in in production or local development, the following external cloud configurations must be completed:

#### Step 1: Google Cloud Console Configuration
1. Open [Google Cloud Console](https://console.cloud.google.com/) $\rightarrow$ **APIs & Services** $\rightarrow$ **Credentials**.
2. Configure the **OAuth Consent Screen**:
   - User Type: External.
   - App Name: `LaxmiLens`.
   - User Support Email: your support email.
   - Developer Contact Information: your contact email.
   - Scopes: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
3. Create **OAuth 2.0 Client ID**:
   - Application Type: **Web application**.
   - Name: `LaxmiLens Supabase Client`.
   - **Authorized JavaScript origins**:
     - Local: `http://localhost:3000`
     - Production: `https://your-domain.app` (e.g., `https://laxmilens.app`)
   - **Authorized redirect URIs**:
     - Must point to your Supabase project authentication endpoint:
       `https://<your-project-id>.supabase.co/auth/v1/callback`
4. Copy the generated **Client ID** and **Client Secret**.

#### Step 2: Supabase Dashboard Configuration
1. In your [Supabase Dashboard](https://supabase.com/dashboard), navigate to **Authentication** $\rightarrow$ **Providers** $\rightarrow$ **Google**.
2. Toggle Google provider to **Enabled**.
3. Paste the **Client ID** and **Client Secret** obtained from Google Cloud Console.
4. Save the configuration.

#### Step 3: Supabase URL Configuration & Redirect Allowlist
1. In Supabase Dashboard, navigate to **Authentication** $\rightarrow$ **URL Configuration**.
2. **Site URL**: Set to your base URL (`http://localhost:3000` during development, or your production URL).
3. **Redirect URLs (Allowlist)**: Add permitted redirect targets:
   - `http://localhost:3000/**`
   - `http://localhost:3000/auth/callback`
   - `https://your-domain.app/**`
   - `https://your-domain.app/auth/callback`

> [!WARNING]
> Google OAuth will fail with `invalid_grant` or `redirect_uri_mismatch` if the authorized redirect URIs in Google Cloud Console do not match `https://<your-project-id>.supabase.co/auth/v1/callback`.

---

## 4. Route Protection & Redirect Sanitization

### Route Guards
- **`ProtectedRoute`**: Inspects `isAuthenticated`. Unauthenticated requests are immediately navigated to `/login`, preserving the intended route in navigation state (`state: { from: location }`).
- **`GuestRoute`**: Inspects `isAuthenticated`. Authenticated users attempting to access guest-only pages (`/login`, `/register`, `/forgot-password`, `/reset-password`, `/auth/callback`) are redirected to `/dashboard` or their target destination.

### Open Redirect & Redirect Loop Defense
The utility `getSafeRedirectUrl(target, fallback = '/dashboard')` enforces:
1. Target must be an internal relative URL (must start with `/` and not `//`).
2. Protocol-relative URLs (e.g. `//evil.com`) are rejected.
3. Explicit schemes (e.g. `javascript:`, `https://`) are rejected.
4. Authentication endpoints (`/login`, `/register`, `/auth/callback`, `/forgot-password`, `/reset-password`) are blacklisted as redirect targets to prevent infinite loops.

---

## 5. Multi-Tenant Isolation & Row Level Security (RLS)

All tables in the Supabase PostgreSQL database have Row Level Security explicitly enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).

Every query, insert, update, and delete is strictly bound to the authenticated user's JWT identity:
```sql
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "accounts_select_own" ON public.accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "accounts_insert_own" ON public.accounts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "accounts_update_own" ON public.accounts FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "accounts_delete_own" ON public.accounts FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "categories_select_own" ON public.categories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "categories_insert_own" ON public.categories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "categories_update_own" ON public.categories FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "categories_delete_own" ON public.categories FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "transactions_select_own" ON public.transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "transactions_insert_own" ON public.transactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "transactions_update_own" ON public.transactions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "transactions_delete_own" ON public.transactions FOR DELETE USING (auth.uid() = user_id);
```

- Direct table access is rejected for unauthenticated users.
- A user can never read, modify, or query another user's financial records.

---

## 6. Defense Against Cross-Tenant Reference Attacks

Even with RLS filtering top-level rows, a malicious actor might craft an API request attempting to attach an `account_id`, `destination_account_id`, or `category_id` belonging to a different tenant into their own transaction.

PostgreSQL triggers validate ownership on every write:

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

## 7. Profile Provisioning & Idempotency

When a new user signs up (via Email/Password or Google OAuth), Supabase executes database trigger `handle_new_user_setup`:
1. Creates a corresponding profile record in `public.profiles` with `id = NEW.id` and display name from user metadata.
2. Uses `ON CONFLICT (id) DO NOTHING` to guarantee idempotency.
3. Automatically seeds initial default categories (Salary, Groceries, Rent, Utilities, etc.) in `public.categories`.
4. Users cannot create or update profile records belonging to other users due to RLS `auth.uid() = id`.
5. Passwords and credentials are never stored in `public.profiles`.

---

## 8. Local-First Compatibility & User Isolation

1. **User Scoping**: All local Dexie records maintain `userId`. Repositories filter records using `[userId+...]` compound indexes.
2. **Logout Preservation**: Signing out does **not** erase the offline IndexedDB store. This allows offline-first access and avoids data loss when working without connectivity.
3. **No Cross-Pollution**: When a different user logs in on the same browser, queries only request records matching the newly authenticated user's ID (`userId = activeUser.id`).
4. **Memory Cache Flushing**: In-memory TanStack Query caches are cleared on sign-out and user change via `queryClient.clear()`.
