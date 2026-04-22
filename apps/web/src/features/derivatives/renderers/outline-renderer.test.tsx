import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { OutlineRenderer } from './outline-renderer';
import { OUTLINE_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('OutlineRenderer', () => {
  it('renders top-level sections, subsections, and topic header', () => {
    render(<OutlineRenderer data={makeDetail('subject_outline', OUTLINE_CONTENT)} />);
    expect(screen.getByText(OUTLINE_CONTENT.topic)).toBeInTheDocument();
    expect(screen.getByText('Search and Seizure')).toBeInTheDocument();
    expect(screen.getByText('Warrantless Exceptions')).toBeInTheDocument();
    expect(screen.getByText('Right to Counsel')).toBeInTheDocument();
  });

  it('renders unavailable when sections are missing', () => {
    render(<OutlineRenderer data={makeDetail('subject_outline', { sections: [] })} />);
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });

  it('omits topic header when content has no topic field', () => {
    const { container } = render(
      <OutlineRenderer
        data={makeDetail('subject_outline', { sections: OUTLINE_CONTENT.sections })}
      />,
    );
    expect(container.textContent).not.toContain('Constitutional Criminal Procedure');
  });
});
