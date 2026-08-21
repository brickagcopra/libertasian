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
  /**
   * Endpoints where 401 is a domain answer (wrong current password, bad MFA
   * code) rather than an expired session. A token refresh is still attempted,
   * but a persistent 401 is thrown to the caller WITHOUT firing the global
   * onUnauthorized handler (which would sign the user out locally).
   */
  skipSignOutOn401?: boolean;
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

/**
 * Hard deadline for every request on this client. React Native's `fetch` has
 * no timeout of its own, so a connection the OS never fails (captive portal,
 * dropped carrier handoff, a stalled TLS handshake) leaves the promise pending
 * forever — and any screen awaiting it spins forever with it.
 */
const REQUEST_TIMEOUT_MS = 20000;

/**
 * The one sentence the app is allowed to show for an entitlement refusal.
 *
 * Names no tier, shows no price, offers no purchase path — App Review 2.1(b)
 * rejected build 20 over a tier name that reached the UI. Matches the wording
 * on `features/derivatives/renderers/gated-notice.tsx`.
 */
export const NOT_INCLUDED_MESSAGE = "This isn't included in your plan.";

/** 402 Payment Required and 403 Forbidden are the API's entitlement refusals. */
function isEntitlementRefusal(statusCode: number): boolean {
  return statusCode === 402 || statusCode === 403;
}

export class ApiClientError extends Error {
  statusCode: number;
  serverMessage: string;

  constructor(statusCode: number, message: string) {
    // Substituted HERE, at the single point every throw path in this client
    // funnels through, rather than per screen: a dozen screens render
    // `error.message` raw, and any new one would inherit the leak. The server
    // body for a 402/403 can name a tier ("requires a pro subscription"), so
    // it is discarded outright — never rendered, never stored.
    const safeMessage = isEntitlementRefusal(statusCode)
      ? NOT_INCLUDED_MESSAGE
      : message;
    super(safeMessage);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.serverMessage = safeMessage;
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

  /**
   * Fire the global sign-out handler. For transports that do not route through
   * `request()` (the SSE stream client) and so cannot reach it themselves.
   * Call only after a refresh-and-retry has already failed — a 401 that a
   * refresh would have fixed must never reach this.
   */
  notifyUnauthorized(): void {
    this.onUnauthorized?.();
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await authStorage.getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * `fetch` with an AbortController deadline. Aborts surface as a 408 so
   * callers get a renderable error instead of a promise that never settles.
   * Non-abort failures (real network errors) propagate untouched.
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ApiClientError(408, 'Request timed out. Check your connection.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
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

  /**
   * Refresh the access token, collapsing concurrent callers onto one request.
   *
   * PUBLIC ON PURPOSE, and the only refresh path any transport may use.
   * Refresh tokens are single-use with rotation and the API revokes the entire
   * token family on reuse detection, so two refreshes racing with the same
   * stored token do not merely waste a round trip — they sign the account out
   * on every device. `streamAiAnswer` runs on `expo/fetch` rather than this
   * client but must still join this single-flight, so it calls this method
   * instead of posting to /auth/refresh itself.
   *
   * Returns true if a new access/refresh pair was stored.
   */
  async attemptRefresh(): Promise<boolean> {
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
      const response = await this.fetchWithTimeout(`${this.baseUrl}/auth/refresh`, {
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
    const { params, skipAuth, skipSignOutOn401, ...init } = options;
    const url = this.buildUrl(endpoint, params);
    const authHeaders = skipAuth ? {} : await this.getAuthHeaders();

    const response = await this.fetchWithTimeout(url, {
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
        const retryResponse = await this.fetchWithTimeout(url, {
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
          if (!skipSignOutOn401) {
            this.onUnauthorized?.();
          }
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

      if (!skipSignOutOn401) {
        this.onUnauthorized?.();
      }
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

  /**
   * `body` is optional because most DELETEs address the resource by URL, but
   * `DELETE /users/me` carries a typed confirmation and a credential — the
   * subject comes from the JWT, so the body is the only place they can go.
   */
  delete<T>(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'DELETE',
      body: body ? JSON.stringify(body) : undefined,
    });
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
