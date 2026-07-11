import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({ id: 'upload-1' })),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUploadDetail = jest.fn();
jest.mock('@/features/camera-scan/hooks/use-upload-status', () => ({
  useUploadDetail: (...args: unknown[]) => mockUploadDetail(...args),
}));

const mockOcrResults = jest.fn();
jest.mock('@/features/camera-scan/hooks/use-ocr-results', () => ({
  useOcrResults: (...args: unknown[]) => mockOcrResults(...args),
}));

jest.mock('@/features/camera-scan/hooks/use-generate-digest', () => ({
  useGenerateDigest: () => ({ mutate: jest.fn(), isPending: false, isSuccess: false, error: null, data: null }),
}));

jest.mock('@/features/camera-scan/hooks/use-generate-flashcards', () => ({
  useGenerateFlashcardsFromScan: () => ({ mutate: jest.fn(), isPending: false, data: null }),
}));

jest.mock('@/features/camera-scan/hooks/use-generate-outline', () => ({
  useGenerateOutlineFromScan: () => ({ mutate: jest.fn(), isPending: false, data: null }),
}));

jest.mock('@/features/camera-scan/hooks/use-attach-to-matter', () => ({
  useAttachToMatter: () => ({ mutate: jest.fn(), isPending: false }),
}));

const mockSubscription = jest.fn();
jest.mock('@/features/subscription/hooks/use-subscription', () => ({
  useSubscription: () => mockSubscription(),
}));

jest.mock('@/features/camera-scan/components/scan-result', () => ({
  ScanResult: ({ upload, showUpgradePrompt }: { upload: { id: string }; showUpgradePrompt: boolean }) => {
    const { Text } = require('react-native');
    return (
      <>
        <Text>ScanResult: {upload.id}</Text>
        {showUpgradePrompt && <Text>Upgrade to generate digests</Text>}
      </>
    );
  },
}));

import ScanResultScreen from '@/app/scan/result/[id]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('ScanResultScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSubscription.mockReturnValue({ data: { planCode: 'free' } });
    mockOcrResults.mockReturnValue({ data: null, isLoading: false });
  });

  it('shows loading state', () => {
    mockUploadDetail.mockReturnValue({ data: undefined, isLoading: true });
    const { getByText } = render(<ScanResultScreen />, { wrapper: createWrapper() });
    expect(getByText('Loading scan details...')).toBeTruthy();
  });

  it('shows not found state when upload is null', () => {
    mockUploadDetail.mockReturnValue({ data: null, isLoading: false });
    const { getByText } = render(<ScanResultScreen />, { wrapper: createWrapper() });
    expect(getByText('Scan not found')).toBeTruthy();
    expect(getByText('Go Back')).toBeTruthy();
  });

  it('navigates back on Go Back press in error state', () => {
    mockUploadDetail.mockReturnValue({ data: null, isLoading: false });
    const { router } = require('expo-router');
    const { getByText } = render(<ScanResultScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Go Back'));
    expect(router.back).toHaveBeenCalled();
  });

  it('renders ScanResult component with upload data', () => {
    mockUploadDetail.mockReturnValue({
      data: { id: 'upload-1', ocrStatus: 'completed', processingStatus: 'completed' },
      isLoading: false,
    });
    const { getByText } = render(<ScanResultScreen />, { wrapper: createWrapper() });
    expect(getByText('ScanResult: upload-1')).toBeTruthy();
  });

  it('shows upgrade prompt for free plan users', () => {
    mockUploadDetail.mockReturnValue({
      data: { id: 'upload-1', ocrStatus: 'completed', processingStatus: 'completed' },
      isLoading: false,
    });
    mockSubscription.mockReturnValue({ data: { planCode: 'free' } });
    const { getByText } = render(<ScanResultScreen />, { wrapper: createWrapper() });
    expect(getByText('Upgrade to generate digests')).toBeTruthy();
  });

  it('does not show upgrade prompt for paid plan', () => {
    mockUploadDetail.mockReturnValue({
      data: { id: 'upload-1', ocrStatus: 'completed', processingStatus: 'completed' },
      isLoading: false,
    });
    mockSubscription.mockReturnValue({ data: { planCode: 'pro' } });
    const { queryByText } = render(<ScanResultScreen />, { wrapper: createWrapper() });
    expect(queryByText('Upgrade to generate digests')).toBeNull();
  });

});
