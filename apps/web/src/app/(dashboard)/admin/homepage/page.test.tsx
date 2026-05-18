import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DEFAULT_HOMEPAGE_CONTENT } from '@/features/homepage/server/homepage-content';

// ─── Mock the site-content hooks ─────────────────────────────

const mockMutateAsync = vi.fn().mockResolvedValue(undefined);
const mockDeleteMutateAsync = vi.fn().mockResolvedValue(undefined);

vi.mock('@/features/admin/hooks/use-site-content', () => ({
  useSiteContent: () => ({
    data: undefined,
    isLoading: false,
    error: null,
  }),
  useUpdateSiteContent: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    error: null,
  }),
  useDeleteSiteContent: () => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
    error: null,
  }),
}));

import AdminHomepagePage from './page';

describe('AdminHomepagePage', () => {
  beforeEach(() => {
    mockMutateAsync.mockClear();
    mockDeleteMutateAsync.mockClear();
  });

  it('renders without throwing', () => {
    render(<AdminHomepagePage />);
    expect(screen.getByText('Homepage Editor')).toBeInTheDocument();
  });

  it('renders all seven section accordion triggers in order', () => {
    render(<AdminHomepagePage />);

    const triggers = screen.getAllByRole('button').filter((el) =>
      el.hasAttribute('data-state') && el.getAttribute('aria-expanded') !== null,
    );

    const labels = triggers.map((el) => el.textContent ?? '');
    expect(labels.some((l) => l.includes('Hero'))).toBe(true);
    expect(labels.some((l) => l.includes('Stats Strip'))).toBe(true);
    expect(labels.some((l) => l.includes('Study Picker'))).toBe(true);
    expect(labels.some((l) => l.includes('Features Accordion'))).toBe(true);
    expect(labels.some((l) => l.includes('Contributors'))).toBe(true);
    expect(labels.some((l) => l.includes('Signup Form'))).toBe(true);
    expect(labels.some((l) => l.includes('Disclaimer') && l.includes('Footer'))).toBe(true);
  });

  it('submitting the unmodified form posts DEFAULT_HOMEPAGE_CONTENT.hero.warm.headlineTop', async () => {
    const { container } = render(<AdminHomepagePage />);

    const form = container.querySelector('#homepage-form') as HTMLFormElement | null;
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });

    const payload = mockMutateAsync.mock.calls[0]![0] as {
      hero: { warm: { headlineTop: string } };
    };
    expect(payload.hero.warm.headlineTop).toBe(
      DEFAULT_HOMEPAGE_CONTENT.hero.warm!.headlineTop,
    );
  });
});
