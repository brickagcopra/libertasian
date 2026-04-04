import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { FlagModal, FlagButton } from './flag-modal';
import { apiClient } from '../../../lib/api-client';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) =>
      require('react').createElement(Text, { testID: `icon-${name}` }, name),
  };
});

jest.mock('../../../lib/api-client', () => ({
  apiClient: {
    post: jest.fn(),
  },
}));

const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('FlagModal', () => {
  const defaultProps = {
    entityType: 'digest' as const,
    entityId: 'd-1',
    visible: true,
    onClose: jest.fn(),
  };

  it('renders modal header', () => {
    const { getByText } = render(<FlagModal {...defaultProps} />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Report Content')).toBeTruthy();
  });

  it('renders all 5 flag reasons', () => {
    const { getByText } = render(<FlagModal {...defaultProps} />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Spam')).toBeTruthy();
    expect(getByText('Inappropriate content')).toBeTruthy();
    expect(getByText('Copyright violation')).toBeTruthy();
    expect(getByText('Inaccurate information')).toBeTruthy();
    expect(getByText('Other')).toBeTruthy();
  });

  it('renders description text', () => {
    const { getByText } = render(<FlagModal {...defaultProps} />, {
      wrapper: createWrapper(),
    });

    expect(
      getByText(/Help us keep the community safe/),
    ).toBeTruthy();
  });

  it('renders cancel button', () => {
    const { getByText } = render(<FlagModal {...defaultProps} />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Cancel')).toBeTruthy();
  });

  it('calls onClose when cancel is pressed', () => {
    const onClose = jest.fn();
    const { getByText } = render(
      <FlagModal {...defaultProps} onClose={onClose} />,
      { wrapper: createWrapper() },
    );

    fireEvent.press(getByText('Cancel'));

    expect(onClose).toHaveBeenCalled();
  });

  it('renders submit button', () => {
    const { getByText } = render(<FlagModal {...defaultProps} />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Submit Report')).toBeTruthy();
  });

  it('renders details text input', () => {
    const { getByPlaceholderText } = render(
      <FlagModal {...defaultProps} />,
      { wrapper: createWrapper() },
    );

    expect(getByPlaceholderText('Provide additional context...')).toBeTruthy();
  });

  it('allows selecting a reason', () => {
    const { getByText } = render(<FlagModal {...defaultProps} />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Spam'));

    expect(getByText('Spam')).toBeTruthy();
  });

  it('submits flag with selected reason', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'flag-1' } });
    const onClose = jest.fn();

    const { getByText } = render(
      <FlagModal {...defaultProps} onClose={onClose} />,
      { wrapper: createWrapper() },
    );

    fireEvent.press(getByText('Copyright violation'));

    await act(async () => {
      fireEvent.press(getByText('Submit Report'));
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/community/flags', {
        entityType: 'digest',
        entityId: 'd-1',
        reason: 'copyright',
        details: undefined,
      });
    });
  });

  it('submits flag with details text', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'flag-2' } });

    const { getByText, getByPlaceholderText } = render(
      <FlagModal {...defaultProps} />,
      { wrapper: createWrapper() },
    );

    fireEvent.press(getByText('Inaccurate information'));
    fireEvent.changeText(
      getByPlaceholderText('Provide additional context...'),
      'The cited case is wrong',
    );

    await act(async () => {
      fireEvent.press(getByText('Submit Report'));
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/community/flags', {
        entityType: 'digest',
        entityId: 'd-1',
        reason: 'inaccurate',
        details: 'The cited case is wrong',
      });
    });
  });

  it('shows success alert after submission', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'flag-3' } });
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { getByText } = render(<FlagModal {...defaultProps} />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Spam'));

    await act(async () => {
      fireEvent.press(getByText('Submit Report'));
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Report Submitted',
        expect.any(String),
      );
    });
  });

  it('shows error alert on failure', async () => {
    mockPost.mockRejectedValueOnce(new Error('Server error'));
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { getByText } = render(<FlagModal {...defaultProps} />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Spam'));

    await act(async () => {
      fireEvent.press(getByText('Submit Report'));
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Error', 'Server error');
    });
  });
});

describe('FlagButton', () => {
  it('renders Report text', () => {
    const { getByText } = render(<FlagButton onPress={jest.fn()} />);

    expect(getByText('Report')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    const { getByText } = render(<FlagButton onPress={onPress} />);

    fireEvent.press(getByText('Report'));

    expect(onPress).toHaveBeenCalled();
  });
});
