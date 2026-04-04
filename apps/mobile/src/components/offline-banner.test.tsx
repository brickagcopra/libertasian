import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

import { OfflineBanner } from './offline-banner';

describe('OfflineBanner', () => {
  it('renders default message', () => {
    const { getByText, getByTestId } = render(<OfflineBanner />);

    expect(getByTestId('offline-banner')).toBeTruthy();
    expect(getByText(/You are offline/)).toBeTruthy();
  });

  it('renders custom message', () => {
    const { getByText } = render(
      <OfflineBanner message="No connection available" />,
    );
    expect(getByText('No connection available')).toBeTruthy();
  });

  it('can be dismissed', () => {
    const { getByTestId, queryByTestId } = render(<OfflineBanner />);

    expect(getByTestId('offline-banner')).toBeTruthy();
    fireEvent.press(getByTestId('offline-banner-dismiss'));
    expect(queryByTestId('offline-banner')).toBeNull();
  });

  it('hides dismiss button when dismissible is false', () => {
    const { queryByTestId } = render(<OfflineBanner dismissible={false} />);

    expect(queryByTestId('offline-banner-dismiss')).toBeNull();
  });
});
