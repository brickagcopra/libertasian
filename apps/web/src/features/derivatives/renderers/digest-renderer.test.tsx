import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DigestRenderer } from './digest-renderer';
import { DIGEST_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('DigestRenderer', () => {
  it('renders every canonical digest section when provided', () => {
    render(<DigestRenderer data={makeDetail('case_digest', DIGEST_CONTENT)} />);
    for (const title of [
      'Summary',
      'Facts',
      "Petitioner's Arguments",
      "Respondent's Arguments",
      'Issues',
      'Ruling',
      'Doctrine',
      'Dispositive',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it('handles string issues as a single-item list', () => {
    render(
      <DigestRenderer
        data={makeDetail('case_digest', { ...DIGEST_CONTENT, issues: 'Single issue' })}
      />,
    );
    expect(screen.getByText('Single issue')).toBeInTheDocument();
  });

  it('renders unavailable when every section is empty', () => {
    render(<DigestRenderer data={makeDetail('case_digest', {})} />);
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });
});
