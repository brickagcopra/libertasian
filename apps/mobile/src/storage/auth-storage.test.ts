import * as SecureStore from 'expo-secure-store';
import { authStorage } from './auth-storage';

// SecureStore is mocked in test/setup.ts
const mockGetItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;
const mockSetItemAsync = SecureStore.setItemAsync as jest.MockedFunction<
  typeof SecureStore.setItemAsync
>;
const mockDeleteItemAsync = SecureStore.deleteItemAsync as jest.MockedFunction<
  typeof SecureStore.deleteItemAsync
>;

describe('authStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAccessToken', () => {
    it('returns token when stored', async () => {
      mockGetItemAsync.mockResolvedValueOnce('my-access-token');

      const token = await authStorage.getAccessToken();

      expect(token).toBe('my-access-token');
      expect(mockGetItemAsync).toHaveBeenCalledWith('auth_access_token');
    });

    it('returns null when no token stored', async () => {
      mockGetItemAsync.mockResolvedValueOnce(null);

      const token = await authStorage.getAccessToken();

      expect(token).toBeNull();
    });
  });

  describe('setAccessToken', () => {
    it('stores the access token', async () => {
      await authStorage.setAccessToken('new-token');

      expect(mockSetItemAsync).toHaveBeenCalledWith(
        'auth_access_token',
        'new-token',
      );
    });
  });

  describe('getRefreshToken', () => {
    it('returns token when stored', async () => {
      mockGetItemAsync.mockResolvedValueOnce('my-refresh-token');

      const token = await authStorage.getRefreshToken();

      expect(token).toBe('my-refresh-token');
      expect(mockGetItemAsync).toHaveBeenCalledWith('auth_refresh_token');
    });

    it('returns null when no token stored', async () => {
      mockGetItemAsync.mockResolvedValueOnce(null);

      const token = await authStorage.getRefreshToken();

      expect(token).toBeNull();
    });
  });

  describe('setRefreshToken', () => {
    it('stores the refresh token', async () => {
      await authStorage.setRefreshToken('refresh-123');

      expect(mockSetItemAsync).toHaveBeenCalledWith(
        'auth_refresh_token',
        'refresh-123',
      );
    });
  });

  describe('clearTokens', () => {
    it('deletes both tokens', async () => {
      await authStorage.clearTokens();

      expect(mockDeleteItemAsync).toHaveBeenCalledTimes(2);
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('auth_access_token');
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('auth_refresh_token');
    });
  });
});
