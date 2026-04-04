import React from 'react';
import { render } from '@testing-library/react-native';

import { OfflineBadge } from './offline-badge';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name, size }: { name: string; size: number }) =>
      require('react').createElement(Text, { testID: `icon-${name}-${size}` }, name),
  };
});

describe('OfflineBadge', () => {
  it('renders "Offline" text', () => {
    const { getByText } = render(<OfflineBadge />);
    expect(getByText('Offline')).toBeTruthy();
  });

  it('renders cloud-done-outline icon at normal size', () => {
    const { getByTestId } = render(<OfflineBadge />);
    expect(getByTestId('icon-cloud-done-outline-12')).toBeTruthy();
  });

  it('renders smaller icon for small size', () => {
    const { getByTestId } = render(<OfflineBadge size="small" />);
    expect(getByTestId('icon-cloud-done-outline-10')).toBeTruthy();
  });

  it('renders correctly with normal size', () => {
    const tree = render(<OfflineBadge size="normal" />).toJSON();
    expect(tree).toBeTruthy();
  });

  it('defaults to normal size', () => {
    const normalTree = render(<OfflineBadge />).toJSON();
    const explicitNormalTree = render(<OfflineBadge size="normal" />).toJSON();
    expect(JSON.stringify(normalTree)).toEqual(JSON.stringify(explicitNormalTree));
  });
});
