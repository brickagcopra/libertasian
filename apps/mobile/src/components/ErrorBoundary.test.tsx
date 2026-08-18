import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

const mockClearTokens = jest.fn<Promise<void>, []>();

jest.mock('@/storage/auth-storage', () => ({
  authStorage: {
    clearTokens: () => mockClearTokens(),
  },
}));

import { ErrorBoundary } from './ErrorBoundary';

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('kaboom');
  }
  return <Text>child rendered</Text>;
}

describe('ErrorBoundary', () => {
  // React logs the caught error to console.error on every boundary hit; the
  // suite asserts on the fallback, not on that noise.
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClearTokens.mockResolvedValue(undefined);
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders children when nothing throws', () => {
    const { getByText, queryByTestId } = render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(getByText('child rendered')).toBeTruthy();
    expect(queryByTestId('error-boundary-fallback')).toBeNull();
  });

  it('renders the fallback with the error message when a child throws', () => {
    const { getByTestId, getByText, queryByText } = render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(getByTestId('error-boundary-fallback')).toBeTruthy();
    expect(getByText('Something went wrong')).toBeTruthy();
    expect(getByText('kaboom')).toBeTruthy();
    expect(queryByText('child rendered')).toBeNull();
  });

  it('"Try again" clears the error and re-renders the children', () => {
    const { getByTestId, getByText, queryByTestId, rerender } = render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(getByTestId('error-boundary-fallback')).toBeTruthy();

    // The child stops throwing before the retry — otherwise the boundary
    // would simply catch the same throw again.
    rerender(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );
    fireEvent.press(getByTestId('error-boundary-retry'));

    expect(queryByTestId('error-boundary-fallback')).toBeNull();
    expect(getByText('child rendered')).toBeTruthy();
  });

  it('"Sign out" clears the stored tokens and routes to login', async () => {
    const { getByTestId } = render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    fireEvent.press(getByTestId('error-boundary-sign-out'));

    await waitFor(() => {
      expect(mockClearTokens).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledWith('/(auth)/login');
    });
  });
});
