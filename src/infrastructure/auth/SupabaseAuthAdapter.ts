import { AuthChangeEvent, AuthPort, AuthUser, SignUpParams } from '@/application/ports/AuthPort';
import { supabase } from '../database/cloud/supabaseClient';

export class SupabaseAuthAdapter implements AuthPort {
  /**
   * Translates Supabase authentication errors into safe, human-readable messages.
   * Internal database errors and stack traces are suppressed.
   */
  private sanitizeError(error: unknown, fallbackMessage: string): Error {
    if (!error || typeof error !== 'object') {
      return new Error(fallbackMessage);
    }

    const message = (error as { message?: string }).message || '';

    if (message.includes('Invalid login credentials')) {
      return new Error('Invalid email or password. Please verify your credentials.');
    }
    if (message.includes('User already registered')) {
      return new Error('An account with this email address already exists. Please sign in instead.');
    }
    if (message.includes('Email not confirmed')) {
      return new Error('Please confirm your email address via the link sent to your inbox before signing in.');
    }
    if (message.includes('Password should be at least')) {
      return new Error('Password must be at least 8 characters long.');
    }
    if (message.includes('rate limit') || message.includes('Rate limit')) {
      return new Error('Too many attempts. Please wait a few moments before trying again.');
    }
    if (message.includes('invalid flow state') || message.includes('code challenge')) {
      return new Error('Authentication session expired or invalid. Please try signing in again.');
    }

    return new Error(message || fallbackMessage);
  }

  public async getCurrentUser(): Promise<AuthUser | null> {
    try {
      const {
        data: { user },
        error
      } = await supabase.auth.getUser();

      if (error || !user) return null;

      return {
        id: user.id,
        email: user.email ?? '',
        displayName: user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email,
        avatarUrl: user.user_metadata?.avatar_url ?? user.user_metadata?.picture
      };
    } catch {
      return null;
    }
  }

  public async signInWithEmail(email: string, password: string): Promise<AuthUser> {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password
      });

      if (error || !data.user) {
        throw this.sanitizeError(error, 'Sign in failed. Please check your credentials.');
      }

      return {
        id: data.user.id,
        email: data.user.email ?? '',
        displayName: data.user.user_metadata?.full_name ?? data.user.email,
        avatarUrl: data.user.user_metadata?.avatar_url ?? data.user.user_metadata?.picture
      };
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error('Sign in failed. Please try again.');
    }
  }

  public async signUpWithEmail(params: SignUpParams): Promise<AuthUser> {
    try {
      const { data, error } = await supabase.auth.signUp({
        email: params.email.trim().toLowerCase(),
        password: params.password,
        options: {
          data: {
            full_name: params.fullName?.trim() || undefined
          }
        }
      });

      if (error || !data.user) {
        throw this.sanitizeError(error, 'Registration failed. Please check your information.');
      }

      return {
        id: data.user.id,
        email: data.user.email ?? '',
        displayName: params.fullName?.trim() || data.user.email,
        avatarUrl: data.user.user_metadata?.avatar_url
      };
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error('Registration failed. Please try again.');
    }
  }

  public async signInWithOAuth(provider: 'google', redirectTo?: string): Promise<void> {
    try {
      const redirect = redirectTo || `${window.location.origin}/auth/callback`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirect,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent'
          }
        }
      });

      if (error) {
        throw this.sanitizeError(error, 'Google sign-in could not be initiated.');
      }
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error('Google sign-in failed. Please try again.');
    }
  }

  public async signOut(): Promise<void> {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw this.sanitizeError(error, 'Sign out failed.');
      }
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error('Sign out failed.');
    }
  }

  public async resetPasswordForEmail(email: string, redirectTo?: string): Promise<void> {
    try {
      const redirect = redirectTo || `${window.location.origin}/reset-password`;

      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: redirect
      });

      if (error) {
        throw this.sanitizeError(error, 'Could not send password reset email.');
      }
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error('Could not send password reset email. Please try again.');
    }
  }

  public async updatePassword(newPassword: string): Promise<void> {
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) {
        throw this.sanitizeError(error, 'Could not update password.');
      }
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error('Could not update password. Please try again.');
    }
  }

  public onAuthStateChange(callback: (user: AuthUser | null, event?: AuthChangeEvent) => void): () => void {
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      const mappedEvent = event as AuthChangeEvent;

      if (session?.user) {
        callback(
          {
            id: session.user.id,
            email: session.user.email ?? '',
            displayName: session.user.user_metadata?.full_name ?? session.user.user_metadata?.name ?? session.user.email,
            avatarUrl: session.user.user_metadata?.avatar_url ?? session.user.user_metadata?.picture
          },
          mappedEvent
        );
      } else {
        callback(null, mappedEvent);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }
}

export const defaultAuthAdapter = new SupabaseAuthAdapter();
