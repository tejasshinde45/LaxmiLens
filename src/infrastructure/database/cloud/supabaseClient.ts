import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '@/config/env';

let cachedSupabaseClient: SupabaseClient | null = null;

/**
 * Returns the single reusable Supabase client instance, initialized lazily on first use
 * with strictly validated public publishable credentials.
 * Service role keys MUST NEVER be placed in or imported by client-side code.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!cachedSupabaseClient) {
    const validatedEnv = getEnv();
    cachedSupabaseClient = createClient(
      validatedEnv.VITE_SUPABASE_URL,
      validatedEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );
  }
  return cachedSupabaseClient;
}

/**
 * Lazy proxy to the singleton Supabase client so importing infrastructure modules
 * does not trigger eager environment validation failures before React mounts.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
  has(_target, prop) {
    return prop in getSupabaseClient();
  },
  ownKeys() {
    return Reflect.ownKeys(getSupabaseClient());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(getSupabaseClient(), prop);
  }
});
