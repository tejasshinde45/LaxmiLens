import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '@/features/auth/pages/LoginPage';
import { RegisterPage } from '@/features/auth/pages/RegisterPage';
import { ForgotPasswordPage } from '@/features/auth/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/features/auth/pages/ResetPasswordPage';
import { AuthContext, AuthContextType } from '@/features/auth/context/AuthContext';

const createMockAuthContext = (overrides: Partial<AuthContextType> = {}): AuthContextType => ({
  user: null,
  isLoading: false,
  isAuthenticated: false,
  signIn: vi.fn().mockResolvedValue(undefined),
  signUp: vi.fn().mockResolvedValue(undefined),
  signInWithGoogle: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
  resetPassword: vi.fn().mockResolvedValue(undefined),
  updatePassword: vi.fn().mockResolvedValue(undefined),
  ...overrides
});

describe('Auth Pages', () => {
  describe('LoginPage', () => {
    it('renders login form elements properly', () => {
      const mockContext = createMockAuthContext();

      render(
        <AuthContext.Provider value={mockContext}>
          <MemoryRouter>
            <LoginPage />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /create an account/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /forgot password/i })).toBeInTheDocument();
    });

    it('triggers validation on empty submission', async () => {
      const mockContext = createMockAuthContext();

      render(
        <AuthContext.Provider value={mockContext}>
          <MemoryRouter>
            <LoginPage />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

      await waitFor(() => {
        expect(screen.getByText(/email is required/i)).toBeInTheDocument();
        expect(screen.getByText(/password is required/i)).toBeInTheDocument();
      });

      expect(mockContext.signIn).not.toHaveBeenCalled();
    });

    it('invokes signInWithGoogle when Google button is clicked', async () => {
      const mockContext = createMockAuthContext();

      render(
        <AuthContext.Provider value={mockContext}>
          <MemoryRouter>
            <LoginPage />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

      await waitFor(() => {
        expect(mockContext.signInWithGoogle).toHaveBeenCalled();
      });
    });
  });

  describe('RegisterPage', () => {
    it('renders registration fields and validates mismatched password', async () => {
      const mockContext = createMockAuthContext();

      render(
        <AuthContext.Provider value={mockContext}>
          <MemoryRouter>
            <RegisterPage />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Arjun Verma' } });
      fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'arjun@example.com' } });
      fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Password123' } });
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'DifferentPass123' } });

      fireEvent.click(screen.getByRole('button', { name: /^create account$/i }));

      await waitFor(() => {
        expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
      });

      expect(mockContext.signUp).not.toHaveBeenCalled();
    });
  });

  describe('ForgotPasswordPage', () => {
    it('submits email and transitions to confirmation state', async () => {
      const mockContext = createMockAuthContext();

      render(
        <AuthContext.Provider value={mockContext}>
          <MemoryRouter>
            <ForgotPasswordPage />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'recovery@laxmilens.app' }
      });
      fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

      await waitFor(() => {
        expect(mockContext.resetPassword).toHaveBeenCalledWith('recovery@laxmilens.app');
        expect(screen.getByText(/check your inbox/i)).toBeInTheDocument();
      });
    });
  });

  describe('ResetPasswordPage', () => {
    it('renders password fields and triggers updatePassword', async () => {
      const mockContext = createMockAuthContext();

      render(
        <AuthContext.Provider value={mockContext}>
          <MemoryRouter>
            <ResetPasswordPage />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      fireEvent.change(screen.getByLabelText(/^new password/i), {
        target: { value: 'NewSecurePass123' }
      });
      fireEvent.change(screen.getByLabelText(/confirm new password/i), {
        target: { value: 'NewSecurePass123' }
      });

      fireEvent.click(screen.getByRole('button', { name: /update password/i }));

      await waitFor(() => {
        expect(mockContext.updatePassword).toHaveBeenCalledWith('NewSecurePass123');
      });
    });
  });
});
