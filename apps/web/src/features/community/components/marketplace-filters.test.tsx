import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { MarketplaceFilters } from './marketplace-filters';

const defaultProps = {
  sortBy: 'newest' as const,
  onSortChange: vi.fn(),
  barSubject: 'all',
  onBarSubjectChange: vi.fn(),
  search: '',
  onSearchChange: vi.fn(),
};

describe('MarketplaceFilters', () => {
  it('renders search input', () => {
    render(<MarketplaceFilters {...defaultProps} />);
    expect(screen.getByPlaceholderText('Search by title...')).toBeInTheDocument();
  });

  it('calls onSearchChange when typing in search input', () => {
    const onSearchChange = vi.fn();
    render(
      <MarketplaceFilters {...defaultProps} onSearchChange={onSearchChange} />,
    );

    const input = screen.getByPlaceholderText('Search by title...');
    fireEvent.change(input, { target: { value: 'civil law' } });

    expect(onSearchChange).toHaveBeenCalledWith('civil law');
  });

  it('displays current search value', () => {
    render(
      <MarketplaceFilters {...defaultProps} search="torts" />,
    );

    const input = screen.getByPlaceholderText('Search by title...') as HTMLInputElement;
    expect(input.value).toBe('torts');
  });

  it('renders sort dropdown with options', () => {
    render(<MarketplaceFilters {...defaultProps} />);
    // The Select trigger should be rendered
    expect(screen.getByText('Newest')).toBeInTheDocument();
  });

  it('renders bar subject filter with "All subjects" option', () => {
    render(
      <MarketplaceFilters
        {...defaultProps}
        barSubjects={[
          { code: 'civil_law', name: 'Civil Law' },
          { code: 'criminal_law', name: 'Criminal Law' },
        ]}
      />,
    );

    // The placeholder/selected value should show
    expect(screen.getByText('All subjects')).toBeInTheDocument();
  });

  it('renders without bar subjects list', () => {
    render(<MarketplaceFilters {...defaultProps} />);
    // Should still render the subject filter trigger without crashing
    expect(screen.getByText('All subjects')).toBeInTheDocument();
  });
});
