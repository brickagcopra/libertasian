import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { StarRatingDisplay, StarRatingInput } from './star-rating';

describe('StarRatingDisplay', () => {
  it('renders 5 star icons', () => {
    const { container } = render(<StarRatingDisplay value={3} />);
    const stars = container.querySelectorAll('svg');
    expect(stars).toHaveLength(5);
  });

  it('displays numeric value when provided', () => {
    render(<StarRatingDisplay value={4.5} />);
    expect(screen.getByText('4.5')).toBeInTheDocument();
  });

  it('displays count in parentheses when provided', () => {
    render(<StarRatingDisplay value={4.0} count={25} />);
    expect(screen.getByText('(25)')).toBeInTheDocument();
  });

  it('does not display numeric value when value is null', () => {
    const { container } = render(<StarRatingDisplay value={null} />);
    // Should only have star icons, no text spans with numeric values
    const spans = container.querySelectorAll('span');
    const numericSpans = Array.from(spans).filter(
      (s) => s.textContent && /^\d/.test(s.textContent),
    );
    expect(numericSpans).toHaveLength(0);
  });

  it('does not display count when not provided', () => {
    const { container } = render(<StarRatingDisplay value={3.0} />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('(');
  });

  it('applies sm size class by default', () => {
    render(<StarRatingDisplay value={3} />);
    const valueText = screen.getByText('3.0');
    expect(valueText.className).toContain('text-xs');
  });

  it('applies md size class when specified', () => {
    render(<StarRatingDisplay value={3} size="md" />);
    const valueText = screen.getByText('3.0');
    expect(valueText.className).toContain('text-sm');
  });
});

describe('StarRatingInput', () => {
  it('renders 5 clickable star buttons', () => {
    const { container } = render(
      <StarRatingInput value={0} onChange={vi.fn()} />,
    );
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(5);
  });

  it('calls onChange with star number on click', () => {
    const onChange = vi.fn();
    const { container } = render(
      <StarRatingInput value={0} onChange={onChange} />,
    );

    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[2]!); // Click star 3

    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('calls onChange with star 1 on first star click', () => {
    const onChange = vi.fn();
    const { container } = render(
      <StarRatingInput value={0} onChange={onChange} />,
    );

    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[0]!);

    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('calls onChange with star 5 on last star click', () => {
    const onChange = vi.fn();
    const { container } = render(
      <StarRatingInput value={0} onChange={onChange} />,
    );

    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[4]!);

    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('highlights stars up to current value', () => {
    const { container } = render(
      <StarRatingInput value={3} onChange={vi.fn()} />,
    );

    const svgs = container.querySelectorAll('svg');
    // Stars 1-3 should be filled (amber), stars 4-5 should not
    for (let i = 0; i < 3; i++) {
      expect(svgs[i]?.className.baseVal || svgs[i]?.getAttribute('class')).toContain('fill-amber');
    }
  });

  it('applies hover effect on mouse enter', () => {
    const { container } = render(
      <StarRatingInput value={0} onChange={vi.fn()} />,
    );

    const buttons = container.querySelectorAll('button');
    fireEvent.mouseEnter(buttons[3]!); // Hover on star 4

    // Stars 1-4 should highlight during hover
    const svgs = container.querySelectorAll('svg');
    for (let i = 0; i < 4; i++) {
      expect(svgs[i]?.className.baseVal || svgs[i]?.getAttribute('class')).toContain('fill-amber');
    }
  });

  it('clears hover effect on mouse leave', () => {
    const { container } = render(
      <StarRatingInput value={2} onChange={vi.fn()} />,
    );

    const buttons = container.querySelectorAll('button');
    fireEvent.mouseEnter(buttons[4]!); // Hover on star 5
    fireEvent.mouseLeave(buttons[4]!); // Leave

    // Should revert to showing value=2 stars
    const svgs = container.querySelectorAll('svg');
    expect(svgs[2]?.className.baseVal || svgs[2]?.getAttribute('class')).toContain('text-gray');
  });
});
