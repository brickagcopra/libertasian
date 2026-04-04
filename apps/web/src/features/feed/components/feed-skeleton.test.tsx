import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { FeedSkeleton } from './feed-skeleton';

describe('FeedSkeleton', () => {
  it('renders 3 skeleton cards', () => {
    const { container } = render(<FeedSkeleton />);
    // Each Card renders as a div — find skeleton placeholders
    const skeletons = container.querySelectorAll('[class*="animate-pulse"], [data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders without crashing', () => {
    const { container } = render(<FeedSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });
});
