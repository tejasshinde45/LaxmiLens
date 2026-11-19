import { AuthPort, AuthUser } from '@/application/ports/AuthPort';
import { supabase } from '../database/cloud/supabaseClient';

export class SupabaseAuthAdapter implements AuthPort {
  public async getCurrentUser(): Promise<AuthUser | null> {
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) return null;

    return {
      id: user.id,
      email: user.email ?? '',
      displayName: user.user_metadata?.full_name ?? user.email
    };
  }

  public async signInWithEmail(email: string, password: string): Promise<AuthUser> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      throw new Error(error?.message || 'Authentication failed');
    }

    return {
      id: data.user.id,
      email: data.user.email ?? '',
      displayName: data.user.user_metadata?.full_name ?? data.user.email
    };
  }

  public async signInWithOAuth(provider: 'google'): Promise<void> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin
      }
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  public async signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  }

  public onAuthStateChange(callback: (user: AuthUser | null) => void): () => void {
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        callback({
          id: session.user.id,
          email: session.user.email ?? '',
          displayName: session.user.user_metadata?.full_name ?? session.user.email
        });
      } else {
        callback(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }
}
