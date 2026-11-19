import { createClient } from '@supabase/supabase-js';
import { env } from '@/config/env';

/**
 * Supabase client instance configured strictly with public anonymous credentials.
 * Service role keys MUST NEVER be placed in or imported by client-side code.
 */
export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
