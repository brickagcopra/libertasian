import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import ClassificationScreen from '@/app/admin/classification/index';

// ---- Mocks ----

const mockRefetchQueue = jest.fn();
const mockRefetchStats = jest.fn();
const mockConfirmMutate = jest.fn();
const mockRejectMutate = jest.fn();
const mockOverrideMutate = jest.fn();

jest.mock('@/features/admin/hooks/use-admin-classification', () => ({
  useClassificationQueue: jest.fn(() => ({
    data: {
      items: [
        {
          id: 'cl-1',
          legalDocumentId: 'doc-1',
          documentTitle: 'People v. Santos G.R. No. 12345',
          predictedPrimary: 'criminal_law',
          predictedSecondary: 'remedial_law',
          confidence: 0.55,
          createdAt: '2026-04-10T10:00:00Z',
        },
        {
          id: 'cl-2',
          legalDocumentId: 'doc-2',
          documentTitle: 'Republic v. CA G.R. No. 67890',
          predictedPrimary: 'civil_law',
          predictedSecondary: null,
          confidence: 0.32,
          createdAt: '2026-04-09T10:00:00Z',
        },
      ],
      meta: { cursor: null, hasMore: false, total: 2 },
    },
    isLoading: false,
    isFetching: false,
    refetch: mockRefetchQueue,
  })),
  useClassificationStats: jest.fn(() => ({
    data: {
      pendingReview: 5,
      confirmedCount: 42,
      rejectedCount: 3,
      overriddenCount: 7,
    },
    isLoading: false,
    refetch: mockRefetchStats,
  })),
  useConfirmClassification: jest.fn(() => ({
    mutate: mockConfirmMutate,
    isPending: false,
  })),
  useRejectClassification: jest.fn(() => ({
    mutate: mockRejectMutate,
    isPending: false,
  })),
  useOverrideClassification: jest.fn(() => ({
    mutate: mockOverrideMutate,
    isPending: false,
  })),
}));

jest.mock('@/features/study/hooks/use-bar-subjects', () => ({
  useBarSubjects: jest.fn(() => ({
    data: [
      { code: 'criminal_law', name: 'Criminal Law', documentCount: 10 },
      { code: 'civil_law', name: 'Civil Law', documentCount: 8 },
    ],
  })),
}));

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  router: { push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('@react-native-picker/picker', () => {
  const React = require('react');
  const Picker = (props: Record<string, unknown>) =>
    React.createElement('Picker', props, props.children);
  Picker.Item = (props: Record<string, unknown>) =>
    React.createElement('Picker.Item', props);
  return { Picker };
});

// ---- Tests ----

describe('ClassificationScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders stats bar', () => {
    render(<ClassificationScreen />);

    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Confirmed')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('Overridden')).toBeTruthy();
  });

  it('renders classification items', () => {
    render(<ClassificationScreen />);

    expect(
      screen.getByText('People v. Santos G.R. No. 12345'),
    ).toBeTruthy();
    expect(
      screen.getByText('Republic v. CA G.R. No. 67890'),
    ).toBeTruthy();
    expect(screen.getByText('criminal_law')).toBeTruthy();
    expect(screen.getByText('civil_law')).toBeTruthy();
  });

  it('renders confidence scores', () => {
    render(<ClassificationScreen />);

    expect(screen.getByText('55%')).toBeTruthy();
    expect(screen.getByText('32%')).toBeTruthy();
  });

  it('renders action buttons for each item', () => {
    render(<ClassificationScreen />);

    const confirmButtons = screen.getAllByText('Confirm');
    const rejectButtons = screen.getAllByText('Reject');
    const overrideButtons = screen.getAllByText('Override');

    expect(confirmButtons.length).toBe(2);
    expect(rejectButtons.length).toBe(2);
    expect(overrideButtons.length).toBe(2);
  });

  it('calls confirm mutation on confirm button press', () => {
    render(<ClassificationScreen />);

    const confirmButtons = screen.getAllByText('Confirm');
    fireEvent.press(confirmButtons[0]);

    expect(mockConfirmMutate).toHaveBeenCalledWith(
      { id: 'cl-1' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('calls reject mutation on reject button press', () => {
    render(<ClassificationScreen />);

    const rejectButtons = screen.getAllByText('Reject');
    fireEvent.press(rejectButtons[0]);

    expect(mockRejectMutate).toHaveBeenCalledWith(
      { id: 'cl-1' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('shows loading state', () => {
    const { useClassificationQueue } = require('@/features/admin/hooks/use-admin-classification');
    useClassificationQueue.mockReturnValueOnce({
      data: null,
      isLoading: true,
      isFetching: false,
      refetch: mockRefetchQueue,
    });

    render(<ClassificationScreen />);

    expect(screen.queryByText('People v. Santos G.R. No. 12345')).toBeNull();
  });
});
