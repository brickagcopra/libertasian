import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders the scales illustration with a title and message', () => {
    render(
      <EmptyState
        illustration="scales"
        title="Nothing to weigh"
        message="Start by backfilling the archive."
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Nothing to weigh' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Start by backfilling the archive.'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Scales of justice/i),
    ).toBeInTheDocument();
  });

  it('renders the archive illustration', () => {
    render(<EmptyState illustration="archive" title="No archive" />);
    expect(screen.getByLabelText(/Open book/i)).toBeInTheDocument();
  });

  it('renders the ingest-pending illustration', () => {
    render(
      <EmptyState illustration="ingest-pending" title="Nothing pending" />,
    );
    expect(
      screen.getByLabelText(/Clock with document/i),
    ).toBeInTheDocument();
  });

  it('renders the optional action node', () => {
    render(
      <EmptyState
        illustration="archive"
        title="Empty"
        action={<button type="button">Refresh</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});
