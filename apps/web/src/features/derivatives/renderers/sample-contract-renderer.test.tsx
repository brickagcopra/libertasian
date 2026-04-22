import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SampleContractRenderer } from './sample-contract-renderer';
import { SAMPLE_CONTRACT_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('SampleContractRenderer', () => {
  it('renders title, parties table, recitals, clauses, schedules, and signatures', () => {
    render(
      <SampleContractRenderer
        data={makeDetail('sample_contract', SAMPLE_CONTRACT_CONTENT)}
      />,
    );
    expect(screen.getByText('Lease Agreement')).toBeInTheDocument();
    expect(screen.getByText('Parties')).toBeInTheDocument();
    expect(screen.getByText('123 Makati Ave., Makati City')).toBeInTheDocument();
    expect(screen.getAllByText('ABC Realty Corp.')).toHaveLength(2);
    expect(screen.getByText('Recitals')).toBeInTheDocument();
    expect(screen.getByText(/Lessor owns the property/)).toBeInTheDocument();
    expect(screen.getByText('Term')).toBeInTheDocument();
    expect(screen.getByText(/Renewal\./)).toBeInTheDocument();
    expect(screen.getByText(/Schedule A — Property/)).toBeInTheDocument();
  });

  it('gates recitals, clauses, schedules, and signatures', () => {
    render(
      <SampleContractRenderer
        data={makeDetail('sample_contract', SAMPLE_CONTRACT_CONTENT, {
          isGated: true,
          upgradeTier: 'edu',
        })}
      />,
    );
    expect(screen.getByText('Lease Agreement')).toBeInTheDocument();
    expect(screen.getByText('Parties')).toBeInTheDocument();
    expect(screen.queryByText('Recitals')).not.toBeInTheDocument();
    expect(screen.queryByText('Term')).not.toBeInTheDocument();
    expect(screen.getByText(/Unlock full content/i)).toBeInTheDocument();
  });

  it('falls back to Unavailable when contentJson is missing', () => {
    render(<SampleContractRenderer data={makeDetail('sample_contract', undefined)} />);
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });

  it('falls back to Unavailable when contractType is missing', () => {
    render(
      <SampleContractRenderer
        data={makeDetail('sample_contract', { clauses: [{ heading: 'Orphan' }] })}
      />,
    );
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });
});
