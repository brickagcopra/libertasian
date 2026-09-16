const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/api/v1';

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
}

interface ApiError {
  message: string;
  statusCode: number;
  error?: string;
}

class ApiClient {
  private baseUrl: string;
  private getAccessToken: (() => string | null) | null = null;
  private onUnauthorized: (() => void) | null = null;
  private refreshAccessToken: (() => Promise<string | null>) | null = null;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /** Configure auth token provider, unauthorized handler, and silent refresh */
  configure(options: {
    getAccessToken: () => string | null;
    onUnauthorized: () => void;
    refreshAccessToken: () => Promise<string | null>;
  }) {
    this.getAccessToken = options.getAccessToken;
    this.onUnauthorized = options.onUnauthorized;
    this.refreshAccessToken = options.refreshAccessToken;
  }

  /** Attempt a silent token refresh, deduplicating concurrent calls */
  private async tryRefresh(): Promise<string | null> {
    if (!this.refreshAccessToken) return null;
    // Deduplicate: if a refresh is already in-flight, reuse it
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshAccessToken().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  /** Trigger a silent token refresh. Deduplicated with the 401 interceptor. */
  async refresh(): Promise<string | null> {
    return this.tryRefresh();
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
    const { params, ...init } = options;

    let url = `${this.baseUrl}${endpoint}`;
    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string>),
    };

    // Inject auth token if available
    const token = this.getAccessToken?.();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const sentWithToken = Boolean(token);

    const response = await fetch(url, {
      ...init,
      headers,
      credentials: 'include', // Send httpOnly cookies automatically
    });

    // On 401, try silent refresh once then retry the request
    if (response.status === 401 && !isRetry) {
      const newToken = await this.tryRefresh();
      if (newToken) {
        return this.request<T>(endpoint, options, true);
      }
      if (!sentWithToken) {
        // No bearer token went out, so there was no session to expire. This is
        // an anonymous caller hitting a guarded route (an analytics beacon on
        // the public landing page was the outage); reporting it as a session
        // expiry drives `onUnauthorized` and ejects the visitor to /login.
        // Surface the 401 to the caller and leave their state alone.
        throw new ApiClientError('Unauthorized', 401);
      }
      // Refresh itself failed → genuine session expiry
      this.onUnauthorized?.();
      throw new ApiClientError('Session expired. Please log in again.', 401);
    }

    if (response.status === 401) {
      // Refresh succeeded but the retried request still returned 401.
      // This is a resource-level denial (e.g. a guard returning 401 instead
      // of 403), NOT a session expiry — do NOT trigger global logout.
      throw new ApiClientError('Forbidden', 403);
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: 'Request failed' })) as ApiError;
      throw new ApiClientError(
        errorBody.message || `HTTP ${response.status}`,
        response.status,
        errorBody,
      );
    }

    return response.json() as Promise<T>;
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

  put<T>(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
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

  /** Upload a file via multipart/form-data with optional progress tracking */
  async uploadMultipart<T>(
    endpoint: string,
    formData: FormData,
    options?: { onProgress?: (percent: number) => void },
    isRetry = false,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = `${this.baseUrl}${endpoint}`;

      xhr.open('POST', url);
      xhr.withCredentials = true; // Send httpOnly cookies

      const token = this.getAccessToken?.();
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      const sentWithToken = Boolean(token);

      if (options?.onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            options.onProgress!(Math.round((event.loaded / event.total) * 100));
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status === 401 && !isRetry) {
          // First 401 — try a silent refresh, then retry once.
          // A tokenless upload that 401s was never an authenticated session,
          // so it must not trigger the global logout/redirect. Same rule as
          // `request()`.
          const expired = () => {
            if (sentWithToken) this.onUnauthorized?.();
            reject(
              new ApiClientError(
                sentWithToken ? 'Session expired. Please log in again.' : 'Unauthorized',
                401,
              ),
            );
          };
          this.tryRefresh().then((newToken) => {
            if (newToken) {
              this.uploadMultipart<T>(endpoint, formData, options, true).then(resolve, reject);
              return;
            }
            expired();
          }, expired);
          return;
        }

        if (xhr.status === 401) {
          // Refresh succeeded but retried upload still 401 → resource-level
          // denial, not session expiry. Do NOT trigger global logout.
          reject(new ApiClientError('Forbidden', 403));
          return;
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as T);
          } catch {
            reject(new ApiClientError('Invalid response', xhr.status));
          }
        } else {
          try {
            const errorBody = JSON.parse(xhr.responseText) as ApiError;
            reject(new ApiClientError(errorBody.message || `HTTP ${xhr.status}`, xhr.status));
          } catch {
            reject(new ApiClientError(`HTTP ${xhr.status}`, xhr.status));
          }
        }
      };

      xhr.onerror = () => {
        reject(new ApiClientError('Network error', 0));
      };

      xhr.send(formData);
    });
  }

  /** Download a binary file (PDF, DOCX, etc.) and trigger browser download */
  async download(endpoint: string, options?: RequestOptions): Promise<void> {
    const { params, ...init } = options ?? {};

    let url = `${this.baseUrl}${endpoint}`;
    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string>),
    };

    const token = this.getAccessToken?.();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...init,
      method: 'GET',
      headers,
      credentials: 'include',
    });

    if (response.status === 401) {
      // Only a request that actually carried a token can have had a session
      // expire — see `request()`.
      if (!token) {
        throw new ApiClientError('Unauthorized', 401);
      }
      this.onUnauthorized?.();
      throw new ApiClientError('Session expired. Please log in again.', 401);
    }

    if (!response.ok) {
      throw new ApiClientError(`Download failed: HTTP ${response.status}`, response.status);
    }

    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition');
    let filename = 'download';
    if (disposition) {
      const match = disposition.match(/filename[^;=\n]*=["']?([^"';\n]+)/);
      if (match?.[1]) {
        filename = decodeURIComponent(match[1]);
      }
    }

    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export const apiClient = new ApiClient(API_BASE_URL);
