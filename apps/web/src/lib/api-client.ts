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

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /** Configure auth token provider and unauthorized handler */
  configure(options: {
    getAccessToken: () => string | null;
    onUnauthorized: () => void;
  }) {
    this.getAccessToken = options.getAccessToken;
    this.onUnauthorized = options.onUnauthorized;
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
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

    const response = await fetch(url, {
      ...init,
      headers,
    });

    if (response.status === 401) {
      this.onUnauthorized?.();
      throw new ApiClientError('Session expired. Please log in again.', 401);
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: 'Request failed' })) as ApiError;
      throw new ApiClientError(
        errorBody.message || `HTTP ${response.status}`,
        response.status,
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

  delete<T>(endpoint: string, options?: RequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  /** Upload a file via multipart/form-data with optional progress tracking */
  async uploadMultipart<T>(
    endpoint: string,
    formData: FormData,
    options?: { onProgress?: (percent: number) => void },
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = `${this.baseUrl}${endpoint}`;

      xhr.open('POST', url);

      const token = this.getAccessToken?.();
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      if (options?.onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            options.onProgress!(Math.round((event.loaded / event.total) * 100));
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status === 401) {
          this.onUnauthorized?.();
          reject(new ApiClientError('Session expired. Please log in again.', 401));
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

    const response = await fetch(url, { ...init, method: 'GET', headers });

    if (response.status === 401) {
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
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export const apiClient = new ApiClient(API_BASE_URL);
