export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
}

export interface AuthPort {
  getCurrentUser(): Promise<AuthUser | null>;
  signInWithEmail(email: string, password: string): Promise<AuthUser>;
  signInWithOAuth(provider: 'google'): Promise<void>;
  signOut(): Promise<void>;
  onAuthStateChange(callback: (user: AuthUser | null) => void): () => void;
}
