import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UsersIcon } from 'lucide-react';

import { KpiCard } from './kpi-card';

describe('KpiCard', () => {
  it('renders label and value', () => {
    render(<KpiCard label="Active Users" value="1,234" />);
    expect(screen.getByText('Active Users')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    const { container } = render(
      <KpiCard label="Users" value="100" icon={UsersIcon} />,
    );
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });

  it('renders up trend indicator', () => {
    const { container } = render(
      <KpiCard label="Revenue" value="$5,000" trend="up" />,
    );
    const greenIcon = container.querySelector('.text-green-500');
    expect(greenIcon).toBeTruthy();
  });

  it('renders down trend indicator', () => {
    const { container } = render(
      <KpiCard label="Churn" value="2.5%" trend="down" />,
    );
    const redIcon = container.querySelector('.text-red-500');
    expect(redIcon).toBeTruthy();
  });

  it('renders neutral trend indicator', () => {
    const { container } = render(
      <KpiCard label="Flat" value="0%" trend="neutral" />,
    );
    const neutralIcon = container.querySelector('.text-muted-foreground');
    expect(neutralIcon).toBeTruthy();
  });

  it('renders comparison text when provided', () => {
    render(
      <KpiCard label="Users" value="500" comparison="vs. 450 last week" />,
    );
    expect(screen.getByText('vs. 450 last week')).toBeInTheDocument();
  });

  it('does not render comparison when not provided', () => {
    const { container } = render(<KpiCard label="Users" value="500" />);
    const comparisonTexts = container.querySelectorAll('.text-xs.text-muted-foreground');
    // Only the label text-sm exists, not the comparison text-xs
    expect(
      Array.from(comparisonTexts).some(
        (el) => el.textContent && el.textContent.includes('vs.'),
      ),
    ).toBe(false);
  });

  it('does not render trend icon when no trend', () => {
    const { container } = render(<KpiCard label="Count" value="10" />);
    const trendIcons = container.querySelectorAll('.text-green-500, .text-red-500');
    expect(trendIcons).toHaveLength(0);
  });
});
