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
    slug: 'constitutional-law',
    title: 'Constitutional Law',
    description: null,
    depth: 0,
    ordering: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    children: [],
  },
  {
    id: 'topic-2',
    syllabusId: 'syl-1',
    parentTopicId: 'topic-1',
    slug: 'bill-of-rights',
    title: 'Bill of Rights',
    description: null,
    depth: 1,
    ordering: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    children: [],
  },
  {
    id: 'topic-3',
    syllabusId: 'syl-1',
    parentTopicId: 'topic-1',
    slug: 'separation-of-powers',
    title: 'Separation of Powers',
    description: null,
    depth: 1,
    ordering: 2,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    children: [],
  },
  {
    id: 'topic-4',
    syllabusId: 'syl-1',
    parentTopicId: null,
    slug: 'election-law',
    title: 'Election Law',
    description: null,
    depth: 0,
    ordering: 2,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    children: [],
  },
];

const mockProgress: Record<string, SyllabusTopicProgress> = {
  'topic-2': { status: 'completed', progressPct: 100 },
  'topic-3': { status: 'in_progress', progressPct: 50 },
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
