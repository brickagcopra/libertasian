import React from 'react';
import { render } from '@testing-library/react-native';

import { ReadinessRing } from './readiness-ring';

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ children, ...props }: { children: React.ReactNode }) =>
      React.createElement(View, { testID: 'svg', ...props }, children),
    Circle: (props: Record<string, unknown>) =>
      React.createElement(View, { testID: 'svg-circle', ...props }),
  };
});

describe('ReadinessRing', () => {
  it('renders percentage text', () => {
    const { getByText } = render(<ReadinessRing pct={75} />);
    expect(getByText('75%')).toBeTruthy();
  });

  it('renders 0% correctly', () => {
    const { getByText } = render(<ReadinessRing pct={0} />);
    expect(getByText('0%')).toBeTruthy();
  });

  it('renders 100% correctly', () => {
    const { getByText } = render(<ReadinessRing pct={100} />);
    expect(getByText('100%')).toBeTruthy();
  });

  it('renders label when provided', () => {
    const { getByText } = render(<ReadinessRing pct={50} label="Ready" />);
    expect(getByText('Ready')).toBeTruthy();
    expect(getByText('50%')).toBeTruthy();
  });

  it('hides label when not provided', () => {
    const { queryByText } = render(<ReadinessRing pct={50} />);
    expect(queryByText('Ready')).toBeNull();
  });

  it('renders SVG circles', () => {
    const { getAllByTestId } = render(<ReadinessRing pct={50} />);
    expect(getAllByTestId('svg-circle').length).toBe(2); // bg + fg circles
  });

  it('renders with custom size', () => {
    const tree = render(<ReadinessRing pct={60} size={120} />).toJSON();
    expect(tree).toBeTruthy();
  });

  it('renders with custom colors', () => {
    const tree = render(
      <ReadinessRing pct={40} color="#ef4444" bgColor="#fee2e2" />,
    ).toJSON();
    expect(tree).toBeTruthy();
  });
});
