import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({
    pageUris: 'file://p1.jpg|file://p2.jpg',
    pageWidths: '800|800',
    pageHeights: '1200|1200',
    pageIds: 'p1|p2',
    pageCount: '2',
  })),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockMutate = jest.fn();
jest.mock('@/features/camera-scan/hooks/use-upload-scan', () => ({
  useUploadScan: () => ({
    mutate: mockMutate,
    isPending: false,
    error: null,
  }),
}));

jest.mock('@/features/camera-scan/hooks/use-upload-status', () => ({
  useUploadStatus: () => ({ data: null }),
}));

jest.mock('@/features/camera-scan/components/upload-progress', () => ({
  UploadProgress: ({ currentStep }: { currentStep: string }) => {
    const { Text } = require('react-native');
    return <Text>Progress: {currentStep}</Text>;
  },
}));

import UploadScreen from '@/app/scan/upload';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('UploadScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders header and page summary', () => {
    const { getByText } = render(<UploadScreen />, { wrapper: createWrapper() });
    expect(getByText('Upload Scan')).toBeTruthy();
    expect(getByText('2 pages ready to upload')).toBeTruthy();
  });

  it('shows privacy toggle defaulting to Private', () => {
    const { getByText } = render(<UploadScreen />, { wrapper: createWrapper() });
    expect(getByText('Private')).toBeTruthy();
  });

  it('shows editorial candidate confirmation dialog on privacy toggle', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText } = render(<UploadScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Private'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Editorial Candidate',
      expect.stringContaining('editors may review'),
      expect.any(Array),
    );
  });

  it('shows Upload & Process button', () => {
    const { getByText } = render(<UploadScreen />, { wrapper: createWrapper() });
    expect(getByText('Upload & Process')).toBeTruthy();
  });

  it('calls upload mutation on Upload press', () => {
    const { getByText } = render(<UploadScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Upload & Process'));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        captureMode: 'multi_page',
        privacyLevel: 'private',
      }),
      expect.any(Object),
    );
  });

  it('handles single page summary text', () => {
    const { useLocalSearchParams } = require('expo-router');
    useLocalSearchParams.mockReturnValue({
      pageUris: 'file://p1.jpg',
      pageWidths: '800',
      pageHeights: '1200',
      pageIds: 'p1',
      pageCount: '1',
    });

    const { getByText } = render(<UploadScreen />, { wrapper: createWrapper() });
    expect(getByText('1 page ready to upload')).toBeTruthy();
  });
});
