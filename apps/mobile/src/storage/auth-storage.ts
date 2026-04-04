import * as SecureStore from 'expo-secure-store';

const AUTH_KEYS = {
  ACCESS_TOKEN: 'auth_access_token',
  REFRESH_TOKEN: 'auth_refresh_token',
} as const;

export const authStorage = {
  async getAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(AUTH_KEYS.ACCESS_TOKEN);
  },

  async setAccessToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(AUTH_KEYS.ACCESS_TOKEN, token);
  },

  async getRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(AUTH_KEYS.REFRESH_TOKEN);
  },

  async setRefreshToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(AUTH_KEYS.REFRESH_TOKEN, token);
  },

  async clearTokens(): Promise<void> {
    await SecureStore.deleteItemAsync(AUTH_KEYS.ACCESS_TOKEN);
    await SecureStore.deleteItemAsync(AUTH_KEYS.REFRESH_TOKEN);
  },
};
