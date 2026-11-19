export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface SignUpParams {
  email: string;
  password: string;
  fullName?: string;
}

export type AuthChangeEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY';

export interface AuthPort {
  getCurrentUser(): Promise<AuthUser | null>;
  signInWithEmail(email: string, password: string): Promise<AuthUser>;
  signUpWithEmail(params: SignUpParams): Promise<AuthUser>;
  signInWithOAuth(provider: 'google', redirectTo?: string): Promise<void>;
  signOut(): Promise<void>;
  resetPasswordForEmail(email: string, redirectTo?: string): Promise<void>;
  updatePassword(newPassword: string): Promise<void>;
  onAuthStateChange(callback: (user: AuthUser | null, event?: AuthChangeEvent) => void): () => void;
}
