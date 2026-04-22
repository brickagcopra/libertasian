import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DoctrineRenderer } from './doctrine-renderer';
import { DOCTRINE_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('DoctrineRenderer', () => {
  it('renders every doctrine entry with confidence badge', () => {
    render(<DoctrineRenderer data={makeDetail('doctrine_extract', DOCTRINE_CONTENT)} />);
    expect(screen.getByText(DOCTRINE_CONTENT.doctrines[0]!.text)).toBeInTheDocument();
    expect(screen.getByText(DOCTRINE_CONTENT.doctrines[1]!.text)).toBeInTheDocument();
    expect(screen.getByText('92% confidence')).toBeInTheDocument();
    expect(screen.getByText('88% confidence')).toBeInTheDocument();
  });

  it('tolerates camelCase doctrineType alongside snake_case', () => {
    render(
      <DoctrineRenderer
        data={makeDetail('doctrine_extract', {
          doctrines: [{ text: 'Camel case', doctrineType: 'principle' }],
        })}
      />,
    );
    expect(screen.getByText('principle')).toBeInTheDocument();
  });

  it('renders unavailable when doctrines array is empty', () => {
    render(<DoctrineRenderer data={makeDetail('doctrine_extract', { doctrines: [] })} />);
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });
});
