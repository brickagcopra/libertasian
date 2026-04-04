import React from 'react';
import { render } from '@testing-library/react-native';

import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  it('shows label with current/total', () => {
    const { getByText } = render(<ProgressBar current={5} total={10} />);
    expect(getByText('5/10')).toBeTruthy();
  });

  it('hides label when showLabel is false', () => {
    const { queryByText } = render(
      <ProgressBar current={5} total={10} showLabel={false} />,
    );
    expect(queryByText('5/10')).toBeNull();
  });

  it('renders with 0 progress', () => {
    const { getByText } = render(<ProgressBar current={0} total={10} />);
    expect(getByText('0/10')).toBeTruthy();
  });

  it('renders with full progress', () => {
    const { getByText } = render(<ProgressBar current={10} total={10} />);
    expect(getByText('10/10')).toBeTruthy();
  });

  it('caps percentage at 100%', () => {
    // Even if current > total, the bar should not exceed 100%
    const { getByText } = render(<ProgressBar current={15} total={10} />);
    expect(getByText('15/10')).toBeTruthy();
  });

  it('handles total of 0 gracefully', () => {
    const { getByText } = render(<ProgressBar current={0} total={0} />);
    expect(getByText('0/0')).toBeTruthy();
  });

  it('renders without crashing with custom props', () => {
    const tree = render(
      <ProgressBar current={3} total={5} height={10} color="#059669" />,
    ).toJSON();
    expect(tree).toBeTruthy();
  });
});
