import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockRestore = vi.fn();
vi.mock('@/features/settings/hooks/use-settings', () => ({
  useRestoreAccount: () => ({ mutateAsync: mockRestore }),
}));

import { ApiClientError } from '@/lib/api-client';
import { RestoreAccountClient } from './restore-account-client';

function renderWithToken(search: string) {
  window.history.replaceState({}, '', `/restore-account${search}`);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RestoreAccountClient />
    </QueryClientProvider>,
  );
}

describe('RestoreAccountClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts the token from the query string and confirms success', async () => {
    mockRestore.mockResolvedValue({ status: 'active' });

    renderWithToken('?token=abc123');

    await waitFor(() => {
      expect(mockRestore).toHaveBeenCalledWith('abc123');
    });
    expect(await screen.findByText('Your account is back')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
  });

  it('shows the invalid state without calling the API when no token is present', async () => {
    renderWithToken('');

    expect(
      await screen.findByText('This restore link no longer works'),
    ).toBeTruthy();
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('surfaces the server message for a used or expired link', async () => {
    mockRestore.mockRejectedValue(
      new ApiClientError('Invalid or expired restore link.', 400),
    );

    renderWithToken('?token=stale');

    expect(
      await screen.findByText('Invalid or expired restore link.'),
    ).toBeTruthy();
  });

  it('distinguishes a transport failure from a bad link', async () => {
    mockRestore.mockRejectedValue(new TypeError('Failed to fetch'));

    renderWithToken('?token=abc123');

    expect(await screen.findByText('Something went wrong')).toBeTruthy();
  });

  it('attempts the single-use token exactly once', async () => {
    mockRestore.mockResolvedValue({ status: 'active' });

    const { rerender } = renderWithToken('?token=abc123');
    await waitFor(() => expect(mockRestore).toHaveBeenCalledTimes(1));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <RestoreAccountClient />
      </QueryClientProvider>,
    );

    // A second POST would answer 400 and flip a successful restore into an
    // error screen.
    await waitFor(() => expect(mockRestore).toHaveBeenCalledTimes(1));
  });
});
