import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PublicHeader } from './public-header';

describe('PublicHeader', () => {
  it('renders the animated Logo (LIBERTASIAN aria-label)', () => {
    render(<PublicHeader />);
    expect(screen.getByLabelText('LIBERTASIAN')).toBeInTheDocument();
  });

  it('renders the 4 public nav links: Features, Bar Exams, Blog, Pricing', () => {
    render(<PublicHeader />);
    expect(screen.getByRole('link', { name: 'Features' })).toHaveAttribute('href', '/#features');
    expect(screen.getByRole('link', { name: 'Bar Exams' })).toHaveAttribute('href', '/bar-exams');
    expect(screen.getByRole('link', { name: 'Blog' })).toHaveAttribute('href', '/blog');
    expect(screen.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing');
  });

  it('renders auth CTAs (Log in + Get Started)', () => {
    render(<PublicHeader />);
    expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get Started' })).toBeInTheDocument();
  });
});
