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

// Default-mock the paywall short-circuit hook so component tests that
// render UpgradeBanner / GatedNotice / paywall surfaces don't need to
// stand up a QueryClient + auth store to exercise the locked-by-default
// path. The default is `{ canAccess: false, reason: 'free' }` — which
// matches how the existing tests construct fixtures (isGated: true,
// previewMode: true). Test files that need to assert variations (admin
// bypass, paid, loading) declare their own `vi.mock` for this hook,
// which takes precedence over this setup-level mock.
vi.mock('@/hooks/useCanAccessPaidFeature', () => ({
  useCanAccessPaidFeature: () => ({ canAccess: false, reason: 'free' }),
}));

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
