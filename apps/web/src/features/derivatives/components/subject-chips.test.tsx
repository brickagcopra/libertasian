import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { SubjectChips } from './subject-chips';

const subjects = [
  { code: 'political_law', name: 'Political Law', taxonomyVersion: 'study_8', count: 5 },
  { code: 'civil_law', name: 'Civil Law', taxonomyVersion: 'study_8', count: 0 },
];

describe('SubjectChips', () => {
  it('renders an "All" chip plus one chip per subject with count', () => {
    render(<SubjectChips subjects={subjects} activeCode={null} onChange={() => {}} />);

    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Political Law')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Civil Law')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('fires onChange with the subject code when clicked', () => {
    const onChange = vi.fn();
    render(<SubjectChips subjects={subjects} activeCode={null} onChange={onChange} />);

    fireEvent.click(screen.getByText('Political Law'));
    expect(onChange).toHaveBeenCalledWith('political_law');
  });

  it('toggles off (sends null) when the active chip is clicked again', () => {
    const onChange = vi.fn();
    render(
      <SubjectChips subjects={subjects} activeCode="political_law" onChange={onChange} />,
    );

    fireEvent.click(screen.getByText('Political Law'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('fires null when the All chip is clicked', () => {
    const onChange = vi.fn();
    render(
      <SubjectChips subjects={subjects} activeCode="political_law" onChange={onChange} />,
    );

    fireEvent.click(screen.getByText('All'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows skeleton state when isLoading', () => {
    const { container } = render(
      <SubjectChips subjects={[]} activeCode={null} onChange={() => {}} isLoading />,
    );
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });
});
