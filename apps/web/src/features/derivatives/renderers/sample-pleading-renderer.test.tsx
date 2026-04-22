import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SamplePleadingRenderer } from './sample-pleading-renderer';
import { SAMPLE_PLEADING_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('SamplePleadingRenderer', () => {
  it('renders caption, parties, sections, prayer, and collapsible verification', () => {
    render(
      <SamplePleadingRenderer
        data={makeDetail('sample_pleading', SAMPLE_PLEADING_CONTENT)}
      />,
    );
    expect(screen.getByText(/Petition for Review on Certiorari/i)).toBeInTheDocument();
    expect(screen.getByText('SUPREME COURT OF THE PHILIPPINES')).toBeInTheDocument();
    expect(
      screen.getByText('Juan Dela Cruz vs. People of the Philippines'),
    ).toBeInTheDocument();
    expect(screen.getByText('G.R. No. 123456')).toBeInTheDocument();
    expect(screen.getByText('Parties')).toBeInTheDocument();
    expect(screen.getByText('Statement of Facts')).toBeInTheDocument();
    expect(screen.getByText('Prayer')).toBeInTheDocument();
    expect(screen.getByText(/Verification & Proof of Service/)).toBeInTheDocument();
  });

  it('gates everything after the caption', () => {
    render(
      <SamplePleadingRenderer
        data={makeDetail('sample_pleading', SAMPLE_PLEADING_CONTENT, {
          isGated: true,
          upgradeTier: 'pro',
        })}
      />,
    );
    expect(screen.getByText('SUPREME COURT OF THE PHILIPPINES')).toBeInTheDocument();
    expect(screen.queryByText('Parties')).not.toBeInTheDocument();
    expect(screen.queryByText('Prayer')).not.toBeInTheDocument();
    expect(screen.getByText(/Unlock full content/i)).toBeInTheDocument();
  });

  it('falls back to Unavailable when contentJson is malformed', () => {
    render(<SamplePleadingRenderer data={makeDetail('sample_pleading', 42)} />);
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });

  it('falls back to Unavailable when pleadingType and caption are missing', () => {
    render(
      <SamplePleadingRenderer
        data={makeDetail('sample_pleading', { prayer: 'WHEREFORE...' })}
      />,
    );
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });
});
