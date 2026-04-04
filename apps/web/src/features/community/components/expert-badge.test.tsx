import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ExpertBadge } from './expert-badge';

describe('ExpertBadge', () => {
  it('renders badge for approved lawyer', () => {
    render(
      <ExpertBadge expertiseType="lawyer" status="approved" />,
    );
    expect(screen.getByText('Lawyer')).toBeInTheDocument();
  });

  it('renders badge for approved law professor', () => {
    render(
      <ExpertBadge expertiseType="law_professor" status="approved" />,
    );
    expect(screen.getByText('Law Professor')).toBeInTheDocument();
  });

  it('renders badge for retired judge', () => {
    render(
      <ExpertBadge expertiseType="judge_retired" status="approved" />,
    );
    expect(screen.getByText('Retired Judge')).toBeInTheDocument();
  });

  it('renders badge for legal researcher', () => {
    render(
      <ExpertBadge expertiseType="legal_researcher" status="approved" />,
    );
    expect(screen.getByText('Legal Researcher')).toBeInTheDocument();
  });

  it('returns null when status is pending', () => {
    const { container } = render(
      <ExpertBadge expertiseType="lawyer" status="pending" />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('returns null when status is rejected', () => {
    const { container } = render(
      <ExpertBadge expertiseType="lawyer" status="rejected" />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('returns null when status is revoked', () => {
    const { container } = render(
      <ExpertBadge expertiseType="lawyer" status="revoked" />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders badge with tooltip trigger attributes', () => {
    render(
      <ExpertBadge expertiseType="lawyer" status="approved" />,
    );
    // The badge should have tooltip trigger data attribute
    const trigger = screen.getByText('Lawyer').closest('[data-slot="tooltip-trigger"]');
    expect(trigger).toBeInTheDocument();
  });

  it('applies sm size by default', () => {
    render(
      <ExpertBadge expertiseType="lawyer" status="approved" />,
    );
    const badge = screen.getByText('Lawyer').closest('[class*="border-emerald"]');
    expect(badge?.className).toContain('text-[10px]');
  });

  it('applies md size when specified', () => {
    render(
      <ExpertBadge expertiseType="lawyer" status="approved" size="md" />,
    );
    const badge = screen.getByText('Lawyer').closest('[class*="border-emerald"]');
    expect(badge?.className).toContain('text-xs');
  });
});
