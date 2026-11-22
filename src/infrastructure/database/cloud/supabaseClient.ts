import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/config/env';

/**
 * Single reusable Supabase client instance configured strictly with validated public publishable credentials.
 * Service role keys MUST NEVER be placed in or imported by client-side code.
 */
export const supabase: SupabaseClient = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
