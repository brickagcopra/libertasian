import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { CodalCard } from './codal-card';
import type { CodalListItem } from '../types';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) =>
      require('react').createElement(Text, { testID: `icon-${name}` }, name),
  };
});

jest.mock('./offline-badge', () => ({
  OfflineBadge: () => {
    const { Text } = require('react-native');
    return require('react').createElement(Text, { testID: 'offline-badge' }, 'Offline');
  },
}));

const mockItem: CodalListItem = {
  id: 'doc-1',
  title: 'Republic Act No. 386 - Civil Code of the Philippines',
  shortTitle: 'Civil Code',
  documentType: 'statute',
  citationText: 'R.A. No. 386',
  promulgationDate: '1949-06-18T12:00:00',
  isOfficial: true,
  sectionCount: 45,
};

describe('CodalCard', () => {
  const defaultProps = {
    item: mockItem,
    isOffline: false,
    isSaving: false,
    onToggleOffline: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders short title when available', () => {
    const { getByText } = render(<CodalCard {...defaultProps} />);
    expect(getByText('Civil Code')).toBeTruthy();
  });

  it('renders full title when no short title', () => {
    const item = { ...mockItem, shortTitle: null };
    const { getByText } = render(<CodalCard {...defaultProps} item={item} />);
    expect(getByText('Republic Act No. 386 - Civil Code of the Philippines')).toBeTruthy();
  });

  it('shows document type badge', () => {
    const { getByText } = render(<CodalCard {...defaultProps} />);
    expect(getByText('statute')).toBeTruthy();
  });

  it('shows Official badge when isOfficial', () => {
    const { getByText } = render(<CodalCard {...defaultProps} />);
    expect(getByText('Official')).toBeTruthy();
  });

  it('hides Official badge when not official', () => {
    const item = { ...mockItem, isOfficial: false };
    const { queryByText } = render(<CodalCard {...defaultProps} item={item} />);
    expect(queryByText('Official')).toBeNull();
  });

  it('shows citation text', () => {
    const { getByText } = render(<CodalCard {...defaultProps} />);
    expect(getByText('R.A. No. 386')).toBeTruthy();
  });

  it('shows section count', () => {
    const { getByText } = render(<CodalCard {...defaultProps} />);
    expect(getByText('45 sections')).toBeTruthy();
  });

  it('shows singular for 1 section', () => {
    const item = { ...mockItem, sectionCount: 1 };
    const { getByText } = render(<CodalCard {...defaultProps} item={item} />);
    expect(getByText('1 section')).toBeTruthy();
  });

  it('shows promulgation date', () => {
    const { getByText } = render(<CodalCard {...defaultProps} />);
    expect(getByText('Jun 18, 1949')).toBeTruthy();
  });

  it('shows offline badge when isOffline', () => {
    const { getByTestId } = render(
      <CodalCard {...defaultProps} isOffline={true} />,
    );
    expect(getByTestId('offline-badge')).toBeTruthy();
  });

  it('navigates to reader on press', () => {
    const { router } = require('expo-router');
    const { getByText } = render(<CodalCard {...defaultProps} />);

    fireEvent.press(getByText('Civil Code'));
    expect(router.push).toHaveBeenCalledWith('/reader/doc-1');
  });

  it('calls onToggleOffline when download icon pressed', () => {
    const onToggleOffline = jest.fn();
    const { getByTestId } = render(
      <CodalCard {...defaultProps} onToggleOffline={onToggleOffline} />,
    );

    fireEvent.press(getByTestId('icon-cloud-download-outline'));
    expect(onToggleOffline).toHaveBeenCalledTimes(1);
  });

  it('shows cloud-done icon when offline', () => {
    const { getByTestId } = render(
      <CodalCard {...defaultProps} isOffline={true} />,
    );
    expect(getByTestId('icon-cloud-done')).toBeTruthy();
  });
});
