import { describe, it, expect } from 'vitest';
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema
} from '@/features/auth/schemas/authSchemas';

describe('Auth Validation Schemas', () => {
  describe('loginSchema', () => {
    it('accepts valid email and password (>= 8 characters)', () => {
      const result = loginSchema.safeParse({
        email: 'user@example.com',
        password: 'Password123'
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid email formats', () => {
      const result = loginSchema.safeParse({
        email: 'not-an-email',
        password: 'Password123'
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('valid email');
      }
    });

    it('rejects password shorter than 8 characters', () => {
      const result = loginSchema.safeParse({
        email: 'user@example.com',
        password: 'Pass1'
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('at least 8 characters');
      }
    });

    it('rejects empty fields', () => {
      const result = loginSchema.safeParse({
        email: '',
        password: ''
      });
      expect(result.success).toBe(false);
    });
  });

  describe('registerSchema', () => {
    it('accepts valid full name, email, matching passwords', () => {
      const result = registerSchema.safeParse({
        fullName: 'Arjun Mehta',
        email: 'arjun@example.com',
        password: 'SecurePass123',
        confirmPassword: 'SecurePass123'
      });
      expect(result.success).toBe(true);
    });

    it('rejects full name shorter than 2 characters', () => {
      const result = registerSchema.safeParse({
        fullName: 'A',
        email: 'arjun@example.com',
        password: 'SecurePass123',
        confirmPassword: 'SecurePass123'
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('at least 2 characters');
      }
    });

    it('rejects password lacking a number', () => {
      const result = registerSchema.safeParse({
        fullName: 'Arjun Mehta',
        email: 'arjun@example.com',
        password: 'PasswordOnly',
        confirmPassword: 'PasswordOnly'
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('at least one number');
      }
    });

    it('rejects mismatched confirmPassword', () => {
      const result = registerSchema.safeParse({
        fullName: 'Arjun Mehta',
        email: 'arjun@example.com',
        password: 'SecurePass123',
        confirmPassword: 'DifferentPass123'
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const confirmIssue = result.error.issues.find((i) => i.path.includes('confirmPassword'));
        expect(confirmIssue?.message).toBe('Passwords do not match');
      }
    });
  });

  describe('forgotPasswordSchema', () => {
    it('accepts valid email', () => {
      const result = forgotPasswordSchema.safeParse({
        email: 'help@laxmilens.app'
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid or empty email', () => {
      expect(forgotPasswordSchema.safeParse({ email: '' }).success).toBe(false);
      expect(forgotPasswordSchema.safeParse({ email: 'bad-email' }).success).toBe(false);
    });
  });

  describe('resetPasswordSchema', () => {
    it('accepts matching new passwords', () => {
      const result = resetPasswordSchema.safeParse({
        password: 'BrandNewPassword1',
        confirmPassword: 'BrandNewPassword1'
      });
      expect(result.success).toBe(true);
    });

    it('rejects mismatched new passwords', () => {
      const result = resetPasswordSchema.safeParse({
        password: 'BrandNewPassword1',
        confirmPassword: 'MismatchPassword2'
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const confirmIssue = result.error.issues.find((i) => i.path.includes('confirmPassword'));
        expect(confirmIssue?.message).toBe('Passwords do not match');
      }
    });
  });
});
