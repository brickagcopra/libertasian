import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

import AdminDashboardScreen from './index';

describe('AdminDashboardScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders navigation cards for Doctrines and Review Queue', () => {
    const { getAllByText } = render(<AdminDashboardScreen />);
    // "Doctrines" appears in both the card title and header subtitle text
    expect(getAllByText(/Doctrines/i).length).toBeGreaterThan(0);
    expect(getAllByText(/Review Queue/i).length).toBeGreaterThan(0);
  });

  it('navigates to doctrines on card press', () => {
    const { getByText } = render(<AdminDashboardScreen />);
    // Use exact text to select only the card title, not the description
    fireEvent.press(getByText('Doctrines'));
    const { router } = require('expo-router');
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('doctrines'));
  });

  it('navigates to review queue on card press', () => {
    const { getByText } = render(<AdminDashboardScreen />);
    // Use exact text to select only the card title
    fireEvent.press(getByText('Review Queue'));
    const { router } = require('expo-router');
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('review'));
  });
});
