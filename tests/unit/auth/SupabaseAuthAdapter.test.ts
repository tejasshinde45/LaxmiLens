import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseAuthAdapter } from '@/infrastructure/auth/SupabaseAuthAdapter';

// Create mock auth functions
const mockGetUser = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockSignUp = vi.fn();
const mockSignInWithOAuth = vi.fn();
const mockSignOut = vi.fn();
const mockResetPasswordForEmail = vi.fn();
const mockUpdateUser = vi.fn();
const mockOnAuthStateChange = vi.fn();

vi.mock('@/infrastructure/database/cloud/supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: () => mockGetUser(),
      signInWithPassword: (params: any) => mockSignInWithPassword(params),
      signUp: (params: any) => mockSignUp(params),
      signInWithOAuth: (params: any) => mockSignInWithOAuth(params),
      signOut: () => mockSignOut(),
      resetPasswordForEmail: (email: string, opts: any) => mockResetPasswordForEmail(email, opts),
      updateUser: (params: any) => mockUpdateUser(params),
      onAuthStateChange: (cb: any) => mockOnAuthStateChange(cb)
    }
  }
}));

describe('SupabaseAuthAdapter', () => {
  let adapter: SupabaseAuthAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new SupabaseAuthAdapter();
  });

  describe('getCurrentUser', () => {
    it('returns formatted AuthUser when user exists in session', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'user-123',
            email: 'test@laxmilens.app',
            user_metadata: { full_name: 'Test User' }
          }
        },
        error: null
      });

      const user = await adapter.getCurrentUser();
      expect(user).toEqual({
        id: 'user-123',
        email: 'test@laxmilens.app',
        displayName: 'Test User',
        avatarUrl: undefined
      });
    });

    it('returns null when error occurs or user is null', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: null },
        error: new Error('Session not found')
      });

      const user = await adapter.getCurrentUser();
      expect(user).toBeNull();
    });
  });

  describe('signInWithEmail', () => {
    it('returns AuthUser upon successful credentials', async () => {
      mockSignInWithPassword.mockResolvedValueOnce({
        data: {
          user: {
            id: 'user-456',
            email: 'verified@laxmilens.app',
            user_metadata: { full_name: 'Verified User' }
          }
        },
        error: null
      });

      const result = await adapter.signInWithEmail('verified@laxmilens.app', 'Secret123');
      expect(result.id).toBe('user-456');
      expect(result.displayName).toBe('Verified User');
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'verified@laxmilens.app',
        password: 'Secret123'
      });
    });

    it('sanitizes "Invalid login credentials" into a user-friendly message', async () => {
      mockSignInWithPassword.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Invalid login credentials' }
      });

      await expect(adapter.signInWithEmail('wrong@laxmilens.app', 'WrongPass123')).rejects.toThrow(
        'Invalid email or password. Please verify your credentials.'
      );
    });
  });

  describe('signUpWithEmail', () => {
    it('sends metadata and returns registered user', async () => {
      mockSignUp.mockResolvedValueOnce({
        data: {
          user: {
            id: 'new-user-789',
            email: 'new@laxmilens.app',
            user_metadata: { full_name: 'New User' }
          }
        },
        error: null
      });

      const result = await adapter.signUpWithEmail({
        email: 'new@laxmilens.app',
        password: 'Password123',
        fullName: 'New User'
      });

      expect(result.id).toBe('new-user-789');
      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'new@laxmilens.app',
        password: 'Password123',
        options: {
          data: {
            full_name: 'New User'
          }
        }
      });
    });

    it('sanitizes "User already registered" message', async () => {
      mockSignUp.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'User already registered' }
      });

      await expect(
        adapter.signUpWithEmail({ email: 'taken@laxmilens.app', password: 'Password123' })
      ).rejects.toThrow('An account with this email address already exists. Please sign in instead.');
    });
  });

  describe('signInWithOAuth', () => {
    it('initiates OAuth redirect with Google provider and fallback URL', async () => {
      mockSignInWithOAuth.mockResolvedValueOnce({
        data: { url: 'https://accounts.google.com/o/oauth2' },
        error: null
      });

      await adapter.signInWithOAuth('google');

      expect(mockSignInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent'
          }
        }
      });
    });
  });

  describe('signOut', () => {
    it('invokes supabase.auth.signOut', async () => {
      mockSignOut.mockResolvedValueOnce({ error: null });
      await adapter.signOut();
      expect(mockSignOut).toHaveBeenCalled();
    });
  });

  describe('resetPasswordForEmail', () => {
    it('passes email and reset redirect URL', async () => {
      mockResetPasswordForEmail.mockResolvedValueOnce({ error: null });
      await adapter.resetPasswordForEmail('user@laxmilens.app');
      expect(mockResetPasswordForEmail).toHaveBeenCalledWith('user@laxmilens.app', {
        redirectTo: `${window.location.origin}/reset-password`
      });
    });
  });

  describe('updatePassword', () => {
    it('invokes supabase.auth.updateUser', async () => {
      mockUpdateUser.mockResolvedValueOnce({ data: { user: {} }, error: null });
      await adapter.updatePassword('BrandNewPass123');
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'BrandNewPass123' });
    });
  });
});
