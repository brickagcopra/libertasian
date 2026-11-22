import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockPost = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiClient: { post: (...args: unknown[]) => mockPost(...args) },
}));

const mockSignOut = jest.fn().mockResolvedValue(undefined);
let mockAuthenticated = true;
jest.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ isAuthenticated: mockAuthenticated, signOut: mockSignOut }),
}));

jest.mock('@/providers/theme-provider', () => ({
  useTheme: () => ({
    theme: {
      surface: '#fff',
      ink: '#000',
      inkSoft: '#333',
      accent: '#00f',
      accentInk: '#fff',
      serif: undefined,
      sans: undefined,
      radius: 8,
    },
  }),
}));

import {
  getSessionDisplacedSnapshot,
  noteIfSessionDisplaced,
  setSessionDisplaced,
} from './session-displaced';
import { SessionDisplacedHost } from './session-displaced-host';

function renderHost() {
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <SessionDisplacedHost />
    </QueryClientProvider>,
  );
  return { ...utils, invalidate };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthenticated = true;
  setSessionDisplaced(false);
});

describe('noteIfSessionDisplaced', () => {
  it('raises the flag only for 409 session_displaced', () => {
    expect(noteIfSessionDisplaced(409, { code: 'conflict' })).toBe(false);
    expect(noteIfSessionDisplaced(429, { code: 'session_displaced' })).toBe(false);
    expect(getSessionDisplacedSnapshot()).toBe(false);
    expect(noteIfSessionDisplaced(409, { code: 'session_displaced' })).toBe(true);
    expect(getSessionDisplacedSnapshot()).toBe(true);
  });
});

describe('SessionDisplacedHost', () => {
  it('is hidden until a request is displaced', () => {
    const { queryByText } = renderHost();
    expect(queryByText('Use it here')).toBeNull();
    act(() => setSessionDisplaced(true));
    expect(queryByText('Use it here')).not.toBeNull();
  });

  it('"Use it here" claims the slot, hides, and refetches', async () => {
    mockPost.mockResolvedValue({ displaced: 1 });
    setSessionDisplaced(true);
    const { getByText, invalidate } = renderHost();

    fireEvent.press(getByText('Use it here'));

    await waitFor(() => expect(getSessionDisplacedSnapshot()).toBe(false));
    expect(mockPost).toHaveBeenCalledWith('/auth/sessions/claim');
    expect(invalidate).toHaveBeenCalled();
  });

  it('stays up with an error when the claim fails', async () => {
    mockPost.mockRejectedValue(new Error('offline'));
    setSessionDisplaced(true);
    const { getByText, findByText } = renderHost();

    fireEvent.press(getByText('Use it here'));

    expect(await findByText(/Could not switch/)).toBeTruthy();
    expect(getSessionDisplacedSnapshot()).toBe(true);
  });

  it('"Sign out" signs out', async () => {
    setSessionDisplaced(true);
    const { getByText } = renderHost();
    fireEvent.press(getByText('Sign out'));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });

  it('clears a stale flag once signed out', () => {
    mockAuthenticated = false;
    setSessionDisplaced(true);
    renderHost();
    expect(getSessionDisplacedSnapshot()).toBe(false);
  });
});
