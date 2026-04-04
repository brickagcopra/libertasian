import { describe, it, expect } from 'vitest';

import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './schemas';

// ─── loginSchema ────────────────────────────────────────────────────

describe('loginSchema', () => {
  it('passes with valid email and password', () => {
    const result = loginSchema.safeParse({
      email: 'atty@libertasian.com',
      password: 'securepassword123',
    });
    expect(result.success).toBe(true);
  });

  it('fails when email is empty', () => {
    const result = loginSchema.safeParse({ email: '', password: 'pass' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Email is required');
    }
  });

  it('fails when email is invalid format', () => {
    const result = loginSchema.safeParse({ email: 'not-email', password: 'pass' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Invalid email address');
    }
  });

  it('fails when password is empty', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Password is required');
    }
  });

  it('accepts optional mfaCode', () => {
    const result = loginSchema.safeParse({
      email: 'a@b.com',
      password: 'pass',
      mfaCode: '123456',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mfaCode).toBe('123456');
    }
  });

  it('allows missing mfaCode', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: 'pass' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mfaCode).toBeUndefined();
    }
  });
});

// ─── registerSchema ─────────────────────────────────────────────────

describe('registerSchema', () => {
  const validData = {
    fullName: 'Atty. Maria Santos',
    email: 'maria@firm.ph',
    password: 'secure1234password',
    confirmPassword: 'secure1234password',
  };

  it('passes with valid registration data', () => {
    const result = registerSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('fails when fullName is empty', () => {
    const result = registerSchema.safeParse({ ...validData, fullName: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Full name is required');
    }
  });

  it('fails when fullName exceeds 255 characters', () => {
    const result = registerSchema.safeParse({ ...validData, fullName: 'A'.repeat(256) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Full name is too long');
    }
  });

  it('fails when email is empty', () => {
    const result = registerSchema.safeParse({ ...validData, email: '' });
    expect(result.success).toBe(false);
  });

  it('fails when email is invalid', () => {
    const result = registerSchema.safeParse({ ...validData, email: 'bad-email' });
    expect(result.success).toBe(false);
  });

  it('enforces minimum 10-character password (CLAUDE.md security requirement)', () => {
    const result = registerSchema.safeParse({ ...validData, password: '123456789', confirmPassword: '123456789' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const passwordIssue = result.error.issues.find(i => i.path.includes('password'));
      expect(passwordIssue?.message).toBe('Password must be at least 10 characters');
    }
  });

  it('accepts exactly 10-character password', () => {
    const result = registerSchema.safeParse({
      ...validData,
      password: '1234567890',
      confirmPassword: '1234567890',
    });
    expect(result.success).toBe(true);
  });

  it('enforces maximum 128-character password', () => {
    const longPass = 'A'.repeat(129);
    const result = registerSchema.safeParse({
      ...validData,
      password: longPass,
      confirmPassword: longPass,
    });
    expect(result.success).toBe(false);
  });

  it('fails when passwords do not match', () => {
    const result = registerSchema.safeParse({
      ...validData,
      password: 'password1234',
      confirmPassword: 'different1234',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const mismatch = result.error.issues.find(i => i.path.includes('confirmPassword'));
      expect(mismatch?.message).toBe('Passwords do not match');
    }
  });

  it('fails when confirmPassword is empty', () => {
    const result = registerSchema.safeParse({ ...validData, confirmPassword: '' });
    expect(result.success).toBe(false);
  });
});

// ─── forgotPasswordSchema ───────────────────────────────────────────

describe('forgotPasswordSchema', () => {
  it('passes with valid email', () => {
    const result = forgotPasswordSchema.safeParse({ email: 'user@example.com' });
    expect(result.success).toBe(true);
  });

  it('fails with empty email', () => {
    const result = forgotPasswordSchema.safeParse({ email: '' });
    expect(result.success).toBe(false);
  });

  it('fails with invalid email', () => {
    const result = forgotPasswordSchema.safeParse({ email: 'not-valid' });
    expect(result.success).toBe(false);
  });
});

// ─── resetPasswordSchema ────────────────────────────────────────────

describe('resetPasswordSchema', () => {
  const validData = {
    token: 'reset-token-abc123',
    newPassword: 'newpassword123',
    confirmPassword: 'newpassword123',
  };

  it('passes with valid data', () => {
    const result = resetPasswordSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('fails when token is empty', () => {
    const result = resetPasswordSchema.safeParse({ ...validData, token: '' });
    expect(result.success).toBe(false);
  });

  it('enforces minimum 10-character new password', () => {
    const result = resetPasswordSchema.safeParse({
      ...validData,
      newPassword: '123456789',
      confirmPassword: '123456789',
    });
    expect(result.success).toBe(false);
  });

  it('enforces maximum 128-character new password', () => {
    const longPass = 'A'.repeat(129);
    const result = resetPasswordSchema.safeParse({
      ...validData,
      newPassword: longPass,
      confirmPassword: longPass,
    });
    expect(result.success).toBe(false);
  });

  it('fails when passwords do not match', () => {
    const result = resetPasswordSchema.safeParse({
      ...validData,
      newPassword: 'newpassword123',
      confirmPassword: 'differentpass12',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const mismatch = result.error.issues.find(i => i.path.includes('confirmPassword'));
      expect(mismatch?.message).toBe('Passwords do not match');
    }
  });

  it('fails when confirmPassword is empty', () => {
    const result = resetPasswordSchema.safeParse({
      ...validData,
      confirmPassword: '',
    });
    expect(result.success).toBe(false);
  });
});
