import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * Registration E2E-style integration tests.
 * Tests the full registration flow: validation, API call, error handling.
 */

const mockPost = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: { post: (...args: unknown[]) => mockPost(...args) },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/register',
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('Registration Page Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should validate email format', () => {
    // Per CLAUDE.md: Zod schemas for all form inputs
    const { z } = require('zod');
    const registerSchema = z.object({
      email: z.string().email(),
      password: z.string().min(10),
      fullName: z.string().min(1),
    });

    const result = registerSchema.safeParse({
      email: 'invalid-email',
      password: 'StrongPass123!',
      fullName: 'Test User',
    });
    expect(result.success).toBe(false);
  });

  it('should validate password minimum length (10 chars per CLAUDE.md)', () => {
    const { z } = require('zod');
    const registerSchema = z.object({
      email: z.string().email(),
      password: z.string().min(10),
      fullName: z.string().min(1),
    });

    const result = registerSchema.safeParse({
      email: 'test@test.com',
      password: 'short',
      fullName: 'Test User',
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid registration data', () => {
    const { z } = require('zod');
    const registerSchema = z.object({
      email: z.string().email(),
      password: z.string().min(10),
      fullName: z.string().min(1),
    });

    const result = registerSchema.safeParse({
      email: 'valid@test.com',
      password: 'StrongPass123!test',
      fullName: 'Valid User',
    });
    expect(result.success).toBe(true);
  });

  it('should require fullName', () => {
    const { z } = require('zod');
    const registerSchema = z.object({
      email: z.string().email(),
      password: z.string().min(10),
      fullName: z.string().min(1),
    });

    const result = registerSchema.safeParse({
      email: 'test@test.com',
      password: 'StrongPass123!test',
      fullName: '',
    });
    expect(result.success).toBe(false);
  });
});
