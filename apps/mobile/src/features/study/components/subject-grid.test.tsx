import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { SubjectGrid } from './subject-grid';
import type { BarSubject } from '../types';

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

const mockSubjects: BarSubject[] = [
  { code: 'civil_law', name: 'Civil Law', documentCount: 150 },
  { code: 'criminal_law', name: 'Criminal Law', documentCount: 95 },
  { code: 'political_law', name: 'Political Law', documentCount: 1 },
];

describe('SubjectGrid', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders all subjects', () => {
    const { getByText } = render(<SubjectGrid subjects={mockSubjects} />);

    expect(getByText('Civil Law')).toBeTruthy();
    expect(getByText('Criminal Law')).toBeTruthy();
    expect(getByText('Political Law')).toBeTruthy();
  });

  it('shows document counts', () => {
    const { getByText } = render(<SubjectGrid subjects={mockSubjects} />);

    expect(getByText('150 docs')).toBeTruthy();
    expect(getByText('95 docs')).toBeTruthy();
  });

  it('shows singular doc for 1', () => {
    const { getByText } = render(<SubjectGrid subjects={mockSubjects} />);
    expect(getByText('1 doc')).toBeTruthy();
  });

  it('renders subject-specific icons', () => {
    const { getByTestId } = render(<SubjectGrid subjects={mockSubjects} />);

    expect(getByTestId('icon-people-outline')).toBeTruthy(); // civil_law
    expect(getByTestId('icon-shield-outline')).toBeTruthy(); // criminal_law
    expect(getByTestId('icon-flag-outline')).toBeTruthy(); // political_law
  });

  it('uses default icon for unknown subjects', () => {
    const subjects = [{ code: 'unknown_law', name: 'Unknown', documentCount: 5 }];
    const { getByTestId } = render(<SubjectGrid subjects={subjects} />);
    expect(getByTestId('icon-book-outline')).toBeTruthy();
  });

  it('navigates to codal page when pressed', () => {
    const { router } = require('expo-router');
    const { getByText } = render(<SubjectGrid subjects={mockSubjects} />);

    fireEvent.press(getByText('Civil Law'));
    expect(router.push).toHaveBeenCalledWith('/codals/civil_law');
  });

  it('calls onSubjectPress when provided', () => {
    const onSubjectPress = jest.fn();
    const { getByText } = render(
      <SubjectGrid subjects={mockSubjects} onSubjectPress={onSubjectPress} />,
    );

    fireEvent.press(getByText('Criminal Law'));
    expect(onSubjectPress).toHaveBeenCalledWith('criminal_law');
  });

  it('renders empty grid with no subjects', () => {
    const tree = render(<SubjectGrid subjects={[]} />).toJSON();
    expect(tree).toBeTruthy();
  });
});
