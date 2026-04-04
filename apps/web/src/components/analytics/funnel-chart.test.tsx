import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { FunnelChart } from './funnel-chart';
import type { AnalyticsFunnelStepRow } from '@libertasian/types';

const makeSteps = (): AnalyticsFunnelStepRow[] => [
  {
    id: 'step-1',
    funnelName: 'signup_to_activation',
    stepName: 'signup',
    stepOrder: 0,
    enteredCount: 1000,
    completedCount: 800,
    droppedCount: 200,
    medianTimeSeconds: 30,
  },
  {
    id: 'step-2',
    funnelName: 'signup_to_activation',
    stepName: 'first_search',
    stepOrder: 1,
    enteredCount: 600,
    completedCount: 500,
    droppedCount: 100,
    medianTimeSeconds: 120,
  },
  {
    id: 'step-3',
    funnelName: 'signup_to_activation',
    stepName: 'activation',
    stepOrder: 2,
    enteredCount: 400,
    completedCount: 350,
    droppedCount: 50,
    medianTimeSeconds: 300,
  },
];

describe('FunnelChart', () => {
  it('renders all steps sorted by stepOrder', () => {
    render(<FunnelChart steps={makeSteps()} />);
    expect(screen.getByText('signup')).toBeInTheDocument();
    expect(screen.getByText('first search')).toBeInTheDocument();
    expect(screen.getByText('activation')).toBeInTheDocument();
  });

  it('shows entered counts for each step', () => {
    render(<FunnelChart steps={makeSteps()} />);
    expect(screen.getByText('1,000 entered')).toBeInTheDocument();
    expect(screen.getByText('600 entered')).toBeInTheDocument();
    expect(screen.getByText('400 entered')).toBeInTheDocument();
  });

  it('shows completed and dropped counts', () => {
    render(<FunnelChart steps={makeSteps()} />);
    expect(screen.getByText('Completed: 800')).toBeInTheDocument();
    expect(screen.getByText('Dropped: 200')).toBeInTheDocument();
  });

  it('shows median time for steps with timing data', () => {
    render(<FunnelChart steps={makeSteps()} />);
    expect(screen.getByText('Median: 30s')).toBeInTheDocument();
    expect(screen.getByText('Median: 120s')).toBeInTheDocument();
  });

  it('shows conversion rate between steps', () => {
    render(<FunnelChart steps={makeSteps()} />);
    // 600/1000 = 60%
    expect(screen.getByText('60.0% conversion')).toBeInTheDocument();
  });

  it('shows drop counts between steps', () => {
    render(<FunnelChart steps={makeSteps()} />);
    // 1000 - 600 = 400 dropped between step 1 and 2
    expect(screen.getByText('(400 dropped)')).toBeInTheDocument();
  });

  it('shows overall conversion summary for 2+ steps', () => {
    render(<FunnelChart steps={makeSteps()} />);
    expect(screen.getByText('Overall Conversion')).toBeInTheDocument();
    // 350 / 1000 = 35%
    expect(screen.getByText('35.0%')).toBeInTheDocument();
  });

  it('handles empty steps array', () => {
    const { container } = render(<FunnelChart steps={[]} />);
    expect(container.firstChild).toBeTruthy();
    expect(screen.queryByText('Overall Conversion')).not.toBeInTheDocument();
  });

  it('handles single step (no conversion arrow)', () => {
    const singleStep = [makeSteps()[0]];
    render(<FunnelChart steps={singleStep} />);
    expect(screen.getByText('signup')).toBeInTheDocument();
    expect(screen.queryByText('conversion')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <FunnelChart steps={makeSteps()} className="custom-class" />,
    );
    expect(container.firstChild).toHaveClass('custom-class');
  });
});
