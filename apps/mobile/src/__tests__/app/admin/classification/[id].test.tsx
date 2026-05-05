import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import ClassificationDetailScreen from '@/app/admin/classification/[id]';

// ---- Mocks ----

const mockConfirmMutate = jest.fn();
const mockRejectMutate = jest.fn();
const mockOverrideMutate = jest.fn();

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(() => ({ id: 'cl-1' })),
  router: { back: jest.fn() },
}));

jest.mock('@/features/admin/hooks/use-admin-classification', () => ({
  useClassificationDetail: jest.fn(() => ({
    data: {
      id: 'cl-1',
      legalDocumentId: 'doc-1',
      documentTitle: 'People v. Santos G.R. No. 12345',
      predictedPrimary: 'criminal_law',
      predictedSecondary: 'remedial_law',
      confidence: 0.55,
      documentType: 'supreme_court_decision',
      court: 'Supreme Court',
      createdAt: '2026-04-10T10:00:00Z',
    },
    isLoading: false,
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

describe('ClassificationDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders document info', () => {
    render(<ClassificationDetailScreen />);

    expect(
      screen.getByText('People v. Santos G.R. No. 12345'),
    ).toBeTruthy();
    expect(screen.getByText('Supreme Court')).toBeTruthy();
    expect(screen.getByText('supreme court decision')).toBeTruthy();
  });

  it('renders AI prediction section', () => {
    render(<ClassificationDetailScreen />);

    expect(screen.getByText('AI Prediction')).toBeTruthy();
    expect(screen.getByText('criminal_law')).toBeTruthy();
    expect(screen.getByText('remedial_law')).toBeTruthy();
    expect(screen.getByText('55%')).toBeTruthy();
  });

  it('renders action buttons', () => {
    render(<ClassificationDetailScreen />);

    expect(screen.getByText('Confirm')).toBeTruthy();
    expect(screen.getByText('Reject')).toBeTruthy();
    expect(screen.getByText('Override')).toBeTruthy();
  });

  it('calls confirm mutation', () => {
    render(<ClassificationDetailScreen />);

    fireEvent.press(screen.getByText('Confirm'));

    expect(mockConfirmMutate).toHaveBeenCalledWith(
      { id: 'cl-1' },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('calls reject mutation', () => {
    render(<ClassificationDetailScreen />);

    fireEvent.press(screen.getByText('Reject'));

    expect(mockRejectMutate).toHaveBeenCalledWith(
      { id: 'cl-1' },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('shows override form when Override button is pressed', () => {
    render(<ClassificationDetailScreen />);

    fireEvent.press(screen.getByText('Override'));

    expect(screen.getByText('Manual Override')).toBeTruthy();
    expect(screen.getByText('Primary Bar Subject')).toBeTruthy();
    expect(screen.getByText('Secondary Bar Subject')).toBeTruthy();
    expect(screen.getByText('Save Override')).toBeTruthy();
  });
});
