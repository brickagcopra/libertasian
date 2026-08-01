import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
    setOnUnauthorized: jest.fn(),
  },
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    serverMessage: string;
    constructor(statusCode: number, message: string) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
      this.serverMessage = message;
    }
  },
}));

const mockSignOut = jest.fn().mockResolvedValue(undefined);
const mockAuthUser = {
  id: 'u1',
  fullName: 'Juan Cruz',
  email: 'juan@libertasian.com',
  emailVerified: true,
  mfaEnabled: false,
  hasPassword: true,
  organizationRole: 'member' as const,
  organizationId: 'org1',
  userRole: null,
  createdAt: '2024-01-15T00:00:00Z',
};
let mockCurrentUser: Record<string, unknown> = { ...mockAuthUser };

jest.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    user: mockCurrentUser,
    signIn: jest.fn(),
    signOut: mockSignOut,
    isAuthenticated: true,
    isLoading: false,
    setUser: jest.fn(),
  }),
}));

const mockClearAll = jest.fn();
jest.mock('@/storage/mmkv', () => ({
  mmkvStorage: { clearAll: () => mockClearAll() },
  STORAGE_KEYS: {},
}));

const mockClearSqlite = jest.fn().mockResolvedValue(undefined);
jest.mock('@/storage/sqlite', () => ({
  clearAllCachedData: () => mockClearSqlite(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

import { router } from 'expo-router';
import { apiClient, ApiClientError } from '@/lib/api-client';
import DeleteAccountRoute from '@/app/settings/delete-account';

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockDelete = apiClient.delete as jest.MockedFunction<
  typeof apiClient.delete
>;
const alertMock = Alert.alert as jest.MockedFunction<typeof Alert.alert>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function renderScreen() {
  return render(<DeleteAccountRoute />, { wrapper: createWrapper() });
}

/**
 * This suite has no jest-native matchers, so read the disabled state off the
 * accessibility props Pressable publishes rather than using `toBeDisabled`.
 */
function isDisabled(element: { props: Record<string, unknown> }): boolean {
  const state = element.props['accessibilityState'] as
    | { disabled?: boolean }
    | undefined;
  return state?.disabled === true || element.props['disabled'] === true;
}

describe('DeleteAccountRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentUser = { ...mockAuthUser };
    mockGet.mockResolvedValue(mockAuthUser as never);
    mockDelete.mockResolvedValue({
      status: 'pending_deletion',
      deletionRequestedAt: '2026-08-01T00:00:00.000Z',
      scheduledPurgeAt: '2026-08-31T00:00:00.000Z',
      restoreWindowDays: 30,
    } as never);
  });

  describe('two-step confirmation', () => {
    it('keeps the delete button disabled until DELETE is typed', () => {
      const utils = renderScreen();

      expect(isDisabled(utils.getByTestId('delete-account-submit'))).toBe(true);

      fireEvent.changeText(
        utils.getByTestId('delete-account-confirm-input'),
        'delete me',
      );
      expect(isDisabled(utils.getByTestId('delete-account-submit'))).toBe(true);
    });

    it('does not reveal the credential field until DELETE is typed', () => {
      const utils = renderScreen();

      expect(
        utils.queryByTestId('delete-account-credential-input'),
      ).toBeNull();

      fireEvent.changeText(
        utils.getByTestId('delete-account-confirm-input'),
        'DELETE',
      );
      expect(
        utils.getByTestId('delete-account-credential-input'),
      ).toBeTruthy();
    });

    it('stays disabled with DELETE typed but no credential', () => {
      const utils = renderScreen();

      fireEvent.changeText(
        utils.getByTestId('delete-account-confirm-input'),
        'DELETE',
      );
      expect(isDisabled(utils.getByTestId('delete-account-submit'))).toBe(true);

      fireEvent.changeText(
        utils.getByTestId('delete-account-credential-input'),
        'my-password',
      );
      expect(isDisabled(utils.getByTestId('delete-account-submit'))).toBe(false);
    });

    it('does not call the API while the form is incomplete', () => {
      const utils = renderScreen();

      fireEvent.press(utils.getByTestId('delete-account-submit'));
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe('credential branch', () => {
    it('sends the password for a password account', async () => {
      const utils = renderScreen();

      fireEvent.changeText(
        utils.getByTestId('delete-account-confirm-input'),
        'DELETE',
      );
      fireEvent.changeText(
        utils.getByTestId('delete-account-credential-input'),
        'my-password',
      );
      fireEvent.press(utils.getByTestId('delete-account-submit'));

      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalledWith(
          '/users/me',
          { confirm: 'DELETE', password: 'my-password' },
          expect.objectContaining({ skipSignOutOn401: true }),
        );
      });
    });

    it('sends the email echo for a social-only account', async () => {
      // hasPassword: false — Google/Apple accounts have no hash to compare.
      mockCurrentUser = { ...mockAuthUser, hasPassword: false };
      mockGet.mockResolvedValue({
        ...mockAuthUser,
        hasPassword: false,
      } as never);

      const utils = renderScreen();

      fireEvent.changeText(
        utils.getByTestId('delete-account-confirm-input'),
        'DELETE',
      );
      fireEvent.changeText(
        utils.getByTestId('delete-account-credential-input'),
        ' juan@libertasian.com ',
      );
      fireEvent.press(utils.getByTestId('delete-account-submit'));

      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalledWith(
          '/users/me',
          { confirm: 'DELETE', email: 'juan@libertasian.com' },
          expect.anything(),
        );
      });
    });
  });

  describe('sole-owner conflict', () => {
    it('renders the API member list verbatim on 409', async () => {
      const serverMessage =
        'You are the only owner of "Dela Cruz Law", which still has 2 other ' +
        'active member(s): Ana Reyes (a***@example.com), Ben Cruz ' +
        '(b***@example.com). Transfer ownership to another member before ' +
        'deleting your account.';
      mockDelete.mockRejectedValue(new ApiClientError(409, serverMessage));

      const utils = renderScreen();

      fireEvent.changeText(
        utils.getByTestId('delete-account-confirm-input'),
        'DELETE',
      );
      fireEvent.changeText(
        utils.getByTestId('delete-account-credential-input'),
        'my-password',
      );
      fireEvent.press(utils.getByTestId('delete-account-submit'));

      await waitFor(() => {
        // Verbatim: the server names who would be stranded, and that list is
        // the actionable part.
        expect(
          utils.getByTestId('delete-account-blocked-message').props.children,
        ).toBe(serverMessage);
      });
      // The account survives — nothing is cleared and the user stays signed in.
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(mockClearAll).not.toHaveBeenCalled();
    });

    it('shows an inline error on 401 without signing the user out', async () => {
      mockDelete.mockRejectedValue(
        new ApiClientError(401, 'Incorrect password.'),
      );

      const utils = renderScreen();

      fireEvent.changeText(
        utils.getByTestId('delete-account-confirm-input'),
        'DELETE',
      );
      fireEvent.changeText(
        utils.getByTestId('delete-account-credential-input'),
        'wrong',
      );
      fireEvent.press(utils.getByTestId('delete-account-submit'));

      await waitFor(() => {
        expect(utils.getByText('Incorrect password')).toBeTruthy();
      });
      expect(mockSignOut).not.toHaveBeenCalled();
    });
  });

  describe('success', () => {
    it('clears MMKV and SQLite, signs out, and routes to login', async () => {
      const utils = renderScreen();

      fireEvent.changeText(
        utils.getByTestId('delete-account-confirm-input'),
        'DELETE',
      );
      fireEvent.changeText(
        utils.getByTestId('delete-account-credential-input'),
        'my-password',
      );
      fireEvent.press(utils.getByTestId('delete-account-submit'));

      await waitFor(() => expect(alertMock).toHaveBeenCalled());

      const [title, body, buttons] = alertMock.mock.calls[0] as [
        string,
        string,
        { text: string; onPress?: () => void }[],
      ];
      expect(title).toBe('Account deleted');
      // The emailed restore link is the only 30-day path — say so.
      expect(body).toContain('30 days');
      expect(body).toContain('juan@libertasian.com');

      buttons[0]?.onPress?.();

      await waitFor(() => {
        expect(mockClearAll).toHaveBeenCalled();
        expect(mockClearSqlite).toHaveBeenCalled();
        expect(mockSignOut).toHaveBeenCalled();
        expect(router.replace).toHaveBeenCalledWith('/(auth)/login');
      });
    });

    it('still signs out when clearing local storage throws', async () => {
      mockClearAll.mockImplementation(() => {
        throw new Error('MMKV unavailable');
      });
      mockClearSqlite.mockRejectedValue(new Error('db locked'));

      const utils = renderScreen();

      fireEvent.changeText(
        utils.getByTestId('delete-account-confirm-input'),
        'DELETE',
      );
      fireEvent.changeText(
        utils.getByTestId('delete-account-credential-input'),
        'my-password',
      );
      fireEvent.press(utils.getByTestId('delete-account-submit'));

      await waitFor(() => expect(alertMock).toHaveBeenCalled());
      const buttons = alertMock.mock.calls[0]?.[2] as {
        onPress?: () => void;
      }[];
      buttons[0]?.onPress?.();

      // The account is already deactivated server-side; a storage failure must
      // not strand the user in a half-signed-in state.
      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalled();
        expect(router.replace).toHaveBeenCalledWith('/(auth)/login');
      });
    });
  });
});
