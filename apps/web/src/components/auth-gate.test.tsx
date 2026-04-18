import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockIsAuthReady = false;

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { isAuthReady: boolean }) => unknown) =>
    selector({ isAuthReady: mockIsAuthReady }),
}));

import { AuthGate } from './auth-gate';

describe('AuthGate', () => {
  beforeEach(() => {
    mockIsAuthReady = false;
  });

  it('renders fallback when isAuthReady is false', () => {
    render(
      <AuthGate fallback={<div>Loading...</div>}>
        <div>Dashboard Content</div>
      </AuthGate>,
    );
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Content')).not.toBeInTheDocument();
  });

  it('renders null fallback by default when isAuthReady is false', () => {
    const { container } = render(
      <AuthGate>
        <div>Dashboard Content</div>
      </AuthGate>,
    );
    expect(screen.queryByText('Dashboard Content')).not.toBeInTheDocument();
    expect(container.innerHTML).toBe('');
  });

  it('renders children when isAuthReady is true', () => {
    mockIsAuthReady = true;
    render(
      <AuthGate fallback={<div>Loading...</div>}>
        <div>Dashboard Content</div>
      </AuthGate>,
    );
    expect(screen.getByText('Dashboard Content')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });
});
