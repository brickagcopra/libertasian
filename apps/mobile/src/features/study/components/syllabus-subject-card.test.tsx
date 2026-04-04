import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { SyllabusSubjectCard } from './syllabus-subject-card';

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

jest.mock('./readiness-ring', () => ({
  ReadinessRing: ({ pct }: { pct: number }) => {
    const { Text } = require('react-native');
    return require('react').createElement(Text, { testID: 'readiness-ring' }, `${pct}%`);
  },
}));

describe('SyllabusSubjectCard', () => {
  const defaultProps = {
    barSubjectCode: 'political_law',
    title: 'Political Law',
    topicCount: 15,
    completedPct: 40,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders title', () => {
    const { getByText } = render(<SyllabusSubjectCard {...defaultProps} />);
    expect(getByText('Political Law')).toBeTruthy();
  });

  it('shows topic count', () => {
    const { getByText } = render(<SyllabusSubjectCard {...defaultProps} />);
    expect(getByText('15 topics')).toBeTruthy();
  });

  it('shows singular for 1 topic', () => {
    const { getByText } = render(
      <SyllabusSubjectCard {...defaultProps} topicCount={1} />,
    );
    expect(getByText('1 topic')).toBeTruthy();
  });

  it('shows readiness ring with percentage', () => {
    const { getByTestId, getByText } = render(
      <SyllabusSubjectCard {...defaultProps} />,
    );
    expect(getByTestId('readiness-ring')).toBeTruthy();
    expect(getByText('40%')).toBeTruthy();
  });

  it('renders subject-specific icon', () => {
    const { getByTestId } = render(
      <SyllabusSubjectCard {...defaultProps} />,
    );
    expect(getByTestId('icon-flag-outline')).toBeTruthy();
  });

  it('navigates to syllabus detail by default', () => {
    const { router } = require('expo-router');
    const { getByText } = render(<SyllabusSubjectCard {...defaultProps} />);

    fireEvent.press(getByText('Political Law'));
    expect(router.push).toHaveBeenCalledWith('/study/syllabus/political_law');
  });

  it('calls onPress when provided instead of default navigation', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <SyllabusSubjectCard {...defaultProps} onPress={onPress} />,
    );

    fireEvent.press(getByText('Political Law'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('uses fallback icon for unknown subject', () => {
    const { getByTestId } = render(
      <SyllabusSubjectCard {...defaultProps} barSubjectCode="unknown_law" />,
    );
    expect(getByTestId('icon-book-outline')).toBeTruthy();
  });
});
