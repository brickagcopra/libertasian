import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// Mock next/link — no JSX in .ts file, use createElement
vi.mock('next/link', () => {
  const React = require('react');
  return {
    default: (props: Record<string, unknown>) =>
      React.createElement('a', { href: props.href }, props.children),
  };
});

// Suppress console.error in tests unless explicitly testing error states
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    // Suppress React act() warnings and intentional test errors
    const message = typeof args[0] === 'string' ? args[0] : '';
    if (
      message.includes('act(') ||
      message.includes('Not implemented: HTMLFormElement') ||
      message.includes('Error: Uncaught')
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});
