import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    uploadMultipart: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockUserState: { user: { isPlatformAdmin?: boolean } | null } = {
  user: null,
};
const mockSubState: {
  data: { planCode: string; status: string } | null;
  isLoading: boolean;
} = { data: null, isLoading: false };

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (s: { user: { isPlatformAdmin?: boolean } | null }) => unknown,
  ) => selector({ user: mockUserState.user }),
}));

// Keep the real meetsMinimumTier — only stub the query hook.
vi.mock('@/features/billing/hooks/use-subscription', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/features/billing/hooks/use-subscription')
    >();
  return {
    ...actual,
    useSubscription: () => ({
      data: mockSubState.data,
      isLoading: mockSubState.isLoading,
    }),
  };
});

import { apiClient } from '@/lib/api-client';
import {
  useUploadDocument,
  useCanUploadDocuments,
  validateDocumentFile,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
} from './use-upload-document';

const mockUpload = vi.mocked(apiClient.uploadMultipart);

function createWrapper(queryClient?: QueryClient) {
  const client =
    queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserState.user = null;
  mockSubState.data = null;
  mockSubState.isLoading = false;
});

describe('useUploadDocument', () => {
  it('uploads file via multipart to /uploads with field name "file"', async () => {
    mockUpload.mockResolvedValueOnce({
      success: true,
      data: { id: 'upload-1', jobId: 'job-1', status: 'pending' },
    });

    const { result } = renderHook(() => useUploadDocument(), {
      wrapper: createWrapper(),
    });

    const file = new File(['%PDF-1.4'], 'contract.pdf', {
      type: 'application/pdf',
    });

    await act(async () => {
      result.current.mutate({ file });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpload).toHaveBeenCalledWith(
      '/uploads',
      expect.any(FormData),
      expect.any(Object),
    );
    const sentForm = mockUpload.mock.calls[0]?.[1] as FormData;
    expect(sentForm.get('file')).toBe(file);
    expect(result.current.data?.data.id).toBe('upload-1');
  });

  it('passes the progress callback through to uploadMultipart', async () => {
    mockUpload.mockResolvedValueOnce({
      success: true,
      data: { id: 'upload-2', jobId: 'job-2', status: 'pending' },
    });

    const { result } = renderHook(() => useUploadDocument(), {
      wrapper: createWrapper(),
    });

    const onProgress = vi.fn();
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });

    await act(async () => {
      result.current.mutate({ file, onProgress });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpload).toHaveBeenCalledWith('/uploads', expect.any(FormData), {
      onProgress,
    });
  });

  it('invalidates the scans list query on success', async () => {
    mockUpload.mockResolvedValueOnce({
      success: true,
      data: { id: 'upload-3', jobId: 'job-3', status: 'pending' },
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUploadDocument(), {
      wrapper: createWrapper(queryClient),
    });

    const file = new File(['%PDF-1.4'], 'brief.pdf', {
      type: 'application/pdf',
    });

    await act(async () => {
      result.current.mutate({ file });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scans'] });
  });

  it('surfaces mutation errors', async () => {
    mockUpload.mockRejectedValueOnce(new Error('Forbidden'));

    const { result } = renderHook(() => useUploadDocument(), {
      wrapper: createWrapper(),
    });

    const file = new File(['%PDF-1.4'], 'blocked.pdf', {
      type: 'application/pdf',
    });

    await act(async () => {
      result.current.mutate({ file });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe('useCanUploadDocuments', () => {
  it('allows platform admins regardless of subscription', () => {
    mockUserState.user = { isPlatformAdmin: true };
    mockSubState.data = null;

    const { result } = renderHook(() => useCanUploadDocuments());

    expect(result.current).toEqual({ allowed: true, loading: false });
  });

  it('reports loading while the subscription query is in flight', () => {
    mockUserState.user = {};
    mockSubState.isLoading = true;

    const { result } = renderHook(() => useCanUploadDocuments());

    expect(result.current).toEqual({ allowed: false, loading: true });
  });

  it('denies free plan users', () => {
    mockUserState.user = {};
    mockSubState.data = { planCode: 'free', status: 'active' };

    const { result } = renderHook(() => useCanUploadDocuments());

    expect(result.current).toEqual({ allowed: false, loading: false });
  });

  it('denies edu plan users (below pro)', () => {
    mockUserState.user = {};
    mockSubState.data = { planCode: 'edu', status: 'active' };

    const { result } = renderHook(() => useCanUploadDocuments());

    expect(result.current).toEqual({ allowed: false, loading: false });
  });

  it('allows active pro plan users', () => {
    mockUserState.user = {};
    mockSubState.data = { planCode: 'pro', status: 'active' };

    const { result } = renderHook(() => useCanUploadDocuments());

    expect(result.current).toEqual({ allowed: true, loading: false });
  });

  it('allows trialing team plan users', () => {
    mockUserState.user = {};
    mockSubState.data = { planCode: 'team', status: 'trialing' };

    const { result } = renderHook(() => useCanUploadDocuments());

    expect(result.current).toEqual({ allowed: true, loading: false });
  });

  it('denies pro plan users with a non-active subscription', () => {
    mockUserState.user = {};
    mockSubState.data = { planCode: 'pro', status: 'past_due' };

    const { result } = renderHook(() => useCanUploadDocuments());

    expect(result.current).toEqual({ allowed: false, loading: false });
  });

  it('denies users with no subscription record', () => {
    mockUserState.user = {};
    mockSubState.data = null;

    const { result } = renderHook(() => useCanUploadDocuments());

    expect(result.current).toEqual({ allowed: false, loading: false });
  });
});

describe('validateDocumentFile', () => {
  function fileOfSize(name: string, type: string, size: number): File {
    const file = new File(['x'], name, { type });
    Object.defineProperty(file, 'size', { value: size });
    return file;
  }

  it('accepts a PDF within the 50MB limit', () => {
    expect(
      validateDocumentFile(fileOfSize('a.pdf', 'application/pdf', MAX_PDF_BYTES)),
    ).toBeNull();
  });

  it('rejects a PDF over 50MB', () => {
    expect(
      validateDocumentFile(
        fileOfSize('a.pdf', 'application/pdf', MAX_PDF_BYTES + 1),
      ),
    ).toMatch(/50MB/);
  });

  it('accepts an image within the 20MB limit', () => {
    expect(
      validateDocumentFile(fileOfSize('a.jpg', 'image/jpeg', MAX_IMAGE_BYTES)),
    ).toBeNull();
  });

  it('rejects an image over 20MB', () => {
    expect(
      validateDocumentFile(
        fileOfSize('a.png', 'image/png', MAX_IMAGE_BYTES + 1),
      ),
    ).toMatch(/20MB/);
  });

  it('rejects unsupported file types', () => {
    expect(
      validateDocumentFile(fileOfSize('a.docx', 'application/msword', 100)),
    ).toMatch(/Unsupported/);
  });

  it('falls back to the extension when the MIME type is missing', () => {
    expect(validateDocumentFile(fileOfSize('scan.webp', '', 100))).toBeNull();
    expect(validateDocumentFile(fileOfSize('doc.pdf', '', 100))).toBeNull();
  });
});
