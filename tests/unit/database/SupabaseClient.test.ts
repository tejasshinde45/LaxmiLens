import { describe, it, expect } from 'vitest';
import { supabase } from '@/infrastructure/database/cloud/supabaseClient';

describe('Supabase Client Infrastructure', () => {
  it('exports a single, valid Supabase client instance', () => {
    expect(supabase).toBeDefined();
    expect(typeof supabase.auth).toBe('object');
    expect(typeof supabase.from).toBe('function');
    expect(typeof supabase.rpc).toBe('function');
  });

  it('configures authentication session options', () => {
    expect(typeof supabase.auth.getSession).toBe('function');
    expect(typeof supabase.auth.onAuthStateChange).toBe('function');
    expect(typeof supabase.auth.signInWithPassword).toBe('function');
    expect(typeof supabase.auth.signUp).toBe('function');
    expect(typeof supabase.auth.signOut).toBe('function');
  });
});
