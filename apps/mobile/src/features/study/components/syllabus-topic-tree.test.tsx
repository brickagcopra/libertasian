import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { SyllabusTopicTree } from './syllabus-topic-tree';
import type { SyllabusTopic, SyllabusTopicProgress } from '../types';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) =>
      require('react').createElement(Text, { testID: `icon-${name}` }, name),
  };
});

const mockTopics: SyllabusTopic[] = [
  {
    id: 'topic-1',
    syllabusId: 'syl-1',
    parentTopicId: null,
    title: 'Constitutional Law',
    ordering: 1,
    children: [],
  },
  {
    id: 'topic-2',
    syllabusId: 'syl-1',
    parentTopicId: 'topic-1',
    title: 'Bill of Rights',
    ordering: 1,
    children: [],
  },
  {
    id: 'topic-3',
    syllabusId: 'syl-1',
    parentTopicId: 'topic-1',
    title: 'Separation of Powers',
    ordering: 2,
    children: [],
  },
  {
    id: 'topic-4',
    syllabusId: 'syl-1',
    parentTopicId: null,
    title: 'Election Law',
    ordering: 2,
    children: [],
  },
];

const mockProgress: Record<string, SyllabusTopicProgress> = {
  'topic-2': { topicId: 'topic-2', status: 'completed', updatedAt: '2026-03-22' },
  'topic-3': { topicId: 'topic-3', status: 'in_progress', updatedAt: '2026-03-22' },
};

describe('SyllabusTopicTree', () => {
  const defaultProps = {
    topics: mockTopics,
    progress: mockProgress,
    onToggle: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders top-level topics', () => {
    const { getByText } = render(<SyllabusTopicTree {...defaultProps} />);

    expect(getByText('Constitutional Law')).toBeTruthy();
    expect(getByText('Election Law')).toBeTruthy();
  });

  it('renders child topics', () => {
    const { getByText } = render(<SyllabusTopicTree {...defaultProps} />);

    expect(getByText('Bill of Rights')).toBeTruthy();
    expect(getByText('Separation of Powers')).toBeTruthy();
  });

  it('shows empty state when no topics', () => {
    const { getByText } = render(
      <SyllabusTopicTree topics={[]} progress={{}} onToggle={jest.fn()} />,
    );
    expect(getByText('No topics defined yet.')).toBeTruthy();
  });

  it('shows checkbox icon for completed topics', () => {
    const { getAllByTestId } = render(
      <SyllabusTopicTree {...defaultProps} />,
    );

    // At least one checkbox icon for the completed topic
    const checkboxes = getAllByTestId('icon-checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(1);
  });

  it('shows square-outline icon for uncompleted topics', () => {
    const { getAllByTestId } = render(
      <SyllabusTopicTree {...defaultProps} />,
    );

    const unchecked = getAllByTestId('icon-square-outline');
    expect(unchecked.length).toBeGreaterThanOrEqual(1);
  });

  it('shows In Progress badge for in-progress topics', () => {
    const { getByText } = render(<SyllabusTopicTree {...defaultProps} />);
    expect(getByText('In Progress')).toBeTruthy();
  });

  it('shows child completion count for parent topics', () => {
    const { getByText } = render(<SyllabusTopicTree {...defaultProps} />);
    // Constitutional Law has 2 children: 1 completed, 1 in progress => "1/2"
    expect(getByText('1/2')).toBeTruthy();
  });

  it('calls onToggle when checkbox pressed', () => {
    const onToggle = jest.fn();
    const { getAllByTestId } = render(
      <SyllabusTopicTree {...defaultProps} onToggle={onToggle} />,
    );

    // Press the first unchecked box
    const unchecked = getAllByTestId('icon-square-outline');
    fireEvent.press(unchecked[0]);
    expect(onToggle).toHaveBeenCalled();
  });

  it('shows expand/collapse chevrons for parent topics', () => {
    const { getAllByTestId } = render(
      <SyllabusTopicTree {...defaultProps} />,
    );

    // Parents with children should show chevron-down (expanded by default)
    const chevrons = getAllByTestId('icon-chevron-down');
    expect(chevrons.length).toBeGreaterThanOrEqual(1);
  });
});
