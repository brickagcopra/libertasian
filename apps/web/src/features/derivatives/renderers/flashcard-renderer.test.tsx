import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FlashcardRenderer } from './flashcard-renderer';
import { FLASHCARD_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('FlashcardRenderer', () => {
  it('renders all card fronts initially', () => {
    render(<FlashcardRenderer data={makeDetail('flashcard', FLASHCARD_CONTENT)} />);
    expect(screen.getByText(FLASHCARD_CONTENT.cards[0]!.front!)).toBeInTheDocument();
    expect(screen.getByText(FLASHCARD_CONTENT.cards[1]!.front!)).toBeInTheDocument();
    expect(screen.queryByText(FLASHCARD_CONTENT.cards[0]!.back!)).not.toBeInTheDocument();
  });

  it('flips a single card to show its back', async () => {
    const user = userEvent.setup();
    render(<FlashcardRenderer data={makeDetail('flashcard', FLASHCARD_CONTENT)} />);
    const flipButtons = screen.getAllByRole('button', { name: /flip/i });
    await user.click(flipButtons[0]!);
    expect(screen.getByText(FLASHCARD_CONTENT.cards[0]!.back!)).toBeInTheDocument();
  });

  it('renders unavailable when no cards are present', () => {
    render(<FlashcardRenderer data={makeDetail('flashcard', {})} />);
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });
});
