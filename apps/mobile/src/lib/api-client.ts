import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { authStorage } from '../storage/auth-storage';

function resolveApiBaseUrl(): string {
  // Explicit override (e.g. EXPO_PUBLIC_API_URL=https://libertasian.com/api/v1
  // pnpm --filter mobile start) wins over the dev loopback so a physical
  // device can hit deployed prod API while running through the dev server.
  const override = process.env['EXPO_PUBLIC_API_URL'];
  if (override) {
    return override;
  }

  // In development, use the correct loopback for the platform:
  // - Android emulator: 10.0.2.2 maps to host machine's localhost
  // - iOS simulator / web: localhost works directly
  if (__DEV__) {
    const host = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
    return `http://${host}:3001/api/v1`;
  }

  // Production: use the URL from app.json extra config
  return (
    (Constants.expoConfig?.extra?.['apiUrl'] as string | undefined) ??
    'https://libertasian.com/api/v1'
  );
}

const API_BASE_URL = resolveApiBaseUrl();

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
  skipAuth?: boolean;
}

interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
}

/**
 * Default headers attached to every request. `X-Client: mobile` opts into the
 * mobile auth transport on the API: refresh tokens travel in the response body
 * instead of an httpOnly Set-Cookie (RN's fetch does not persist cookies).
 */
const DEFAULT_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Client': 'mobile',
};

export class ApiClientError extends Error {
  statusCode: number;
  serverMessage: string;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.serverMessage = message;
  }
}

type UnauthorizedHandler = () => void;

/**
 * NestJS controllers in this repo hand-roll a `{ success, data }` envelope on
 * every response. Strip it once at the transport layer so callers can type
 * requests as `apiClient.get<T>(...)` and receive `T` directly. Envelopes that
 * carry sibling fields like `meta` (pagination) are returned untouched so
 * those callers can still read `meta` directly. Raw arrays/primitives/error
 * bodies are also returned untouched.
 */
function unwrapEnvelope<T>(payload: unknown): T {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    'success' in payload &&
    'data' in payload
  ) {
    const keys = Object.keys(payload as object);
    const isPlainEnvelope = keys.every((k) => k === 'success' || k === 'data' || k === 'message');
    if (!isPlainEnvelope) {
      return payload as T;
    }
    const env = payload as { success: boolean; data: T; message?: string };
    if (env.success === false) {
      throw new ApiClientError(200, env.message ?? 'Request failed');
    }
    return env.data;
  }
  return payload as T;
}

class ApiClient {
  private baseUrl: string;
  private isRefreshing = false;
  private refreshPromise: Promise<boolean> | null = null;
  private onUnauthorized: UnauthorizedHandler | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setOnUnauthorized(handler: UnauthorizedHandler): void {
    this.onUnauthorized = handler;
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await authStorage.getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private buildUrl(endpoint: string, params?: Record<string, string>): string {
    let url = `${this.baseUrl}${endpoint}`;
    if (params) {
      const entries = Object.entries(params).filter(
        ([, v]) => v !== undefined && v !== null && v !== '',
      );
      if (entries.length > 0) {
        const searchParams = new URLSearchParams(entries);
        url += `?${searchParams.toString()}`;
      }
    }
    return url;
  }

  private async attemptRefresh(): Promise<boolean> {
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = this.doRefresh();

    try {
      return await this.refreshPromise;
    } finally {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }
  }

  private async doRefresh(): Promise<boolean> {
    const refreshToken = await authStorage.getRefreshToken();
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { ...DEFAULT_HEADERS },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) return false;

      const data = (await response.json()) as {
        success: boolean;
        data: { accessToken: string; refreshToken: string };
      };
      if (!data.data?.accessToken || !data.data?.refreshToken) return false;
      await authStorage.setAccessToken(data.data.accessToken);
      await authStorage.setRefreshToken(data.data.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const { params, skipAuth, ...init } = options;
    const url = this.buildUrl(endpoint, params);
    const authHeaders = skipAuth ? {} : await this.getAuthHeaders();

    const response = await fetch(url, {
      ...init,
      headers: {
        ...DEFAULT_HEADERS,
        ...authHeaders,
        ...(init.headers as Record<string, string>),
      },
    });

    if (response.status === 401 && !skipAuth) {
      const refreshed = await this.attemptRefresh();
      if (refreshed) {
        const retryHeaders = await this.getAuthHeaders();
        const retryResponse = await fetch(url, {
          ...init,
          headers: {
            ...DEFAULT_HEADERS,
            ...retryHeaders,
            ...(init.headers as Record<string, string>),
          },
        });

        if (retryResponse.ok) {
          if (retryResponse.status === 204) return undefined as T;
          const retryJson = await retryResponse.json();
          return unwrapEnvelope<T>(retryJson);
        }

        if (retryResponse.status === 401) {
          this.onUnauthorized?.();
          const error = await retryResponse
            .json()
            .catch(() => ({ message: 'Session expired' }));
          throw new ApiClientError(
            401,
            (error as ApiError).message || 'Session expired',
          );
        }

        return this.handleErrorResponse<T>(retryResponse);
      }

      this.onUnauthorized?.();
      throw new ApiClientError(401, 'Session expired. Please sign in again.');
    }

    if (!response.ok) {
      return this.handleErrorResponse<T>(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const json = await response.json();
    return unwrapEnvelope<T>(json);
  }

  private async handleErrorResponse<T>(response: Response): Promise<T> {
    const error = await response
      .json()
      .catch(() => ({ message: `Request failed with status ${response.status}` }));
    throw new ApiClientError(
      response.status,
      (error as ApiError).message || `HTTP ${response.status}`,
    );
  }

  get<T>(endpoint: string, options?: RequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  post<T>(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  patch<T>(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  put<T>(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(endpoint: string, options?: RequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  /** Build a fully-authenticated GET URL for file downloads (used with FileSystem.downloadAsync) */
  async getDownloadUrl(endpoint: string, params?: Record<string, string>): Promise<{ url: string; headers: Record<string, string> }> {
    const url = this.buildUrl(endpoint, params);
    const authHeaders = await this.getAuthHeaders();
    return { url, headers: authHeaders };
  }

  async uploadMultipart<T>(
    endpoint: string,
    formData: FormData,
    options?: { onProgress?: (progress: number) => void },
  ): Promise<T> {
    const url = this.buildUrl(endpoint);
    const authHeaders = await this.getAuthHeaders();

    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);

      // Note: do not set Content-Type — XHR/FormData manages multipart boundary.
      xhr.setRequestHeader('X-Client', 'mobile');

      for (const [key, value] of Object.entries(authHeaders)) {
        xhr.setRequestHeader(key, value);
      }

      if (options?.onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            options.onProgress!(event.loaded / event.total);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status === 401) {
          this.attemptRefresh().then((refreshed) => {
            if (refreshed) {
              this.uploadMultipart<T>(endpoint, formData, options)
                .then(resolve)
                .catch(reject);
            } else {
              this.onUnauthorized?.();
              reject(new ApiClientError(401, 'Session expired. Please sign in again.'));
            }
          }).catch(reject);
          return;
        }

        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(unwrapEnvelope<T>(data));
          } else {
            const err = data as ApiError;
            reject(new ApiClientError(xhr.status, err.message || `HTTP ${xhr.status}`));
          }
        } catch {
          reject(new ApiClientError(xhr.status, `Request failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => {
        reject(new ApiClientError(0, 'Network error'));
      };

      xhr.send(formData);
    });
  }
}

export const apiClient = new ApiClient(API_BASE_URL);
