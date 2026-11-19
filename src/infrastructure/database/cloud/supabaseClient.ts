import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/config/env';

/**
 * Validates and retrieves required Supabase connection parameters.
 * Reads through Vite's import.meta.env with fallback to validated env config.
 */
function getSupabaseConfig(): { supabaseUrl: string; supabaseKey: string } {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const supabaseKey =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error(
      'Missing Supabase configuration: VITE_SUPABASE_URL is not defined. Please configure VITE_SUPABASE_URL in your .env.local file.'
    );
  }

  if (!supabaseKey) {
    throw new Error(
      'Missing Supabase configuration: VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY) is not defined. Please configure VITE_SUPABASE_PUBLISHABLE_KEY in your .env.local file.'
    );
  }

  return { supabaseUrl, supabaseKey };
}

const { supabaseUrl, supabaseKey } = getSupabaseConfig();

/**
 * Single reusable Supabase client instance configured strictly with public anonymous/publishable credentials.
 * Service role keys MUST NEVER be placed in or imported by client-side code.
 */
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
