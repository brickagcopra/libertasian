import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { GenericRenderer } from './generic-renderer';
import { makeDetail } from './__fixtures__/fixtures';

describe('GenericRenderer', () => {
  it('prefers contentPlainText when available', () => {
    render(
      <GenericRenderer
        data={makeDetail('one_page_summary', { anything: 'ignored' }, {
          contentPlainText: 'Plain-text body wins.',
        })}
      />,
    );
    expect(screen.getByText('Plain-text body wins.')).toBeInTheDocument();
  });

  it('falls back to keyed sections derived from contentJson', () => {
    render(
      <GenericRenderer
        data={makeDetail('sample_pleading', {
          caption: 'In re: Petitioner',
          allegations: ['Para 1', 'Para 2'],
          prayer: 'Wherefore...',
        })}
      />,
    );
    expect(screen.getByText('Caption')).toBeInTheDocument();
    expect(screen.getByText('Allegations')).toBeInTheDocument();
    expect(screen.getByText('Prayer')).toBeInTheDocument();
    expect(screen.getByText('In re: Petitioner')).toBeInTheDocument();
    expect(screen.getByText('Para 1')).toBeInTheDocument();
  });

  it('renders unavailable notice when content is empty', () => {
    render(<GenericRenderer data={makeDetail('one_page_summary', {})} />);
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });
});
