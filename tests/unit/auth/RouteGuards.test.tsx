import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '@/app/router/ProtectedRoute';
import { GuestRoute } from '@/app/router/GuestRoute';
import { AuthContext, AuthContextType } from '@/features/auth/context/AuthContext';

const createMockAuthContext = (overrides: Partial<AuthContextType> = {}): AuthContextType => ({
  user: null,
  isLoading: false,
  isAuthenticated: false,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
  resetPassword: vi.fn(),
  updatePassword: vi.fn(),
  ...overrides
});

describe('Route Guards', () => {
  describe('ProtectedRoute', () => {
    it('shows loading screen while session is restoring', () => {
      const mockContext = createMockAuthContext({ isLoading: true });

      render(
        <AuthContext.Provider value={mockContext}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <Routes>
              <Route element={<ProtectedRoute />}>
                <Route path="/dashboard" element={<div>Dashboard Secret Content</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      expect(screen.getByText(/restoring session/i)).toBeInTheDocument();
      expect(screen.queryByText('Dashboard Secret Content')).not.toBeInTheDocument();
    });

    it('redirects unauthenticated users to /login and hides protected content', () => {
      const mockContext = createMockAuthContext({
        isLoading: false,
        isAuthenticated: false,
        user: null
      });

      render(
        <AuthContext.Provider value={mockContext}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <Routes>
              <Route path="/login" element={<div>Login Page Form</div>} />
              <Route element={<ProtectedRoute />}>
                <Route path="/dashboard" element={<div>Dashboard Secret Content</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      expect(screen.getByText('Login Page Form')).toBeInTheDocument();
      expect(screen.queryByText('Dashboard Secret Content')).not.toBeInTheDocument();
    });

    it('renders protected child content when user is authenticated', () => {
      const mockContext = createMockAuthContext({
        isLoading: false,
        isAuthenticated: true,
        user: { id: 'u1', email: 'test@laxmilens.app' }
      });

      render(
        <AuthContext.Provider value={mockContext}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <Routes>
              <Route element={<ProtectedRoute />}>
                <Route path="/dashboard" element={<div>Dashboard Secret Content</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      expect(screen.getByText('Dashboard Secret Content')).toBeInTheDocument();
    });
  });

  describe('GuestRoute', () => {
    it('shows loading screen while session is being verified', () => {
      const mockContext = createMockAuthContext({ isLoading: true });

      render(
        <AuthContext.Provider value={mockContext}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route element={<GuestRoute />}>
                <Route path="/login" element={<div>Guest Login Page</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      expect(screen.getByText(/checking session/i)).toBeInTheDocument();
      expect(screen.queryByText('Guest Login Page')).not.toBeInTheDocument();
    });

    it('renders guest child content when user is unauthenticated', () => {
      const mockContext = createMockAuthContext({
        isLoading: false,
        isAuthenticated: false,
        user: null
      });

      render(
        <AuthContext.Provider value={mockContext}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route element={<GuestRoute />}>
                <Route path="/login" element={<div>Guest Login Page</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      expect(screen.getByText('Guest Login Page')).toBeInTheDocument();
    });

    it('redirects authenticated users away from guest pages to /dashboard', () => {
      const mockContext = createMockAuthContext({
        isLoading: false,
        isAuthenticated: true,
        user: { id: 'u1', email: 'test@laxmilens.app' }
      });

      render(
        <AuthContext.Provider value={mockContext}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/dashboard" element={<div>User Dashboard</div>} />
              <Route element={<GuestRoute />}>
                <Route path="/login" element={<div>Guest Login Page</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      expect(screen.getByText('User Dashboard')).toBeInTheDocument();
      expect(screen.queryByText('Guest Login Page')).not.toBeInTheDocument();
    });
  });
});
