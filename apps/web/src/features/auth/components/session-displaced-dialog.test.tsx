import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const post = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: { post: (...args: unknown[]) => post(...args) },
  ApiClientError: class extends Error {},
}));

const logoutMutate = vi.fn();
vi.mock('../hooks/use-auth', () => ({
  useLogout: () => ({ mutate: logoutMutate, isPending: false }),
}));

import { useAuthStore } from '@/stores/auth-store';
import {
  noteIfSessionDisplaced,
  useSessionDisplacedStore,
} from '@/lib/session-displaced';
import { SessionDisplacedDialog } from './session-displaced-dialog';

function renderDialog() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <SessionDisplacedDialog />
    </QueryClientProvider>,
  );
  return { invalidate };
}

describe('noteIfSessionDisplaced', () => {
  beforeEach(() => useSessionDisplacedStore.setState({ displaced: false }));

  it('raises the flag only for 409 session_displaced', () => {
    expect(noteIfSessionDisplaced(409, { code: 'conflict' })).toBe(false);
    expect(noteIfSessionDisplaced(429, { code: 'session_displaced' })).toBe(false);
    expect(useSessionDisplacedStore.getState().displaced).toBe(false);
    expect(noteIfSessionDisplaced(409, { code: 'session_displaced' })).toBe(true);
    expect(useSessionDisplacedStore.getState().displaced).toBe(true);
  });
});

describe('SessionDisplacedDialog', () => {
  beforeEach(() => {
    post.mockReset();
    logoutMutate.mockReset();
    useAuthStore.setState({ isAuthenticated: true });
    useSessionDisplacedStore.setState({ displaced: false });
  });

  it('stays closed until a request is displaced', () => {
    renderDialog();
    expect(screen.queryByText(/another device/i)).toBeNull();
  });

  it('"Use it here" claims the slot, closes, and refetches', async () => {
    post.mockResolvedValue({ success: true, data: { displaced: 1 } });
    useSessionDisplacedStore.setState({ displaced: true });
    const { invalidate } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Use it here' }));

    await waitFor(() => expect(useSessionDisplacedStore.getState().displaced).toBe(false));
    expect(post).toHaveBeenCalledWith('/auth/sessions/claim');
    expect(invalidate).toHaveBeenCalled();
  });

  it('keeps the dialog open with an error when the claim fails', async () => {
    post.mockRejectedValue(new Error('offline'));
    useSessionDisplacedStore.setState({ displaced: true });
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Use it here' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(useSessionDisplacedStore.getState().displaced).toBe(true);
  });

  it('"Sign out" logs out', () => {
    useSessionDisplacedStore.setState({ displaced: true });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logoutMutate).toHaveBeenCalled();
  });

  it('clears a stale flag once signed out', () => {
    useAuthStore.setState({ isAuthenticated: false });
    useSessionDisplacedStore.setState({ displaced: true });
    renderDialog();
    expect(useSessionDisplacedStore.getState().displaced).toBe(false);
  });
});
