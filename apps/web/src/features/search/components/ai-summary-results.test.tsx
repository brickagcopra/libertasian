import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockUseAiAnswerStream = vi.fn();
vi.mock('../hooks/use-ai-answer-stream', () => ({
  useAiAnswerStream: () => mockUseAiAnswerStream(),
}));

import { AiSummaryResults } from './ai-summary-results';
import { ABSTENTION_FALLBACK } from './abstention-copy';

/** An abstained, finished stream carrying `reason` straight off the wire. */
function abstainedWith(reason: string | undefined) {
  mockUseAiAnswerStream.mockReturnValue({
    text: '',
    sources: [],
    isStreaming: false,
    isDone: true,
    error: null,
    confidence: null,
    abstained: true,
    abstentionReason: reason,
    retryCount: 0,
    reset: vi.fn(),
  });
}

describe('AiSummaryResults abstention copy', () => {
  afterEach(() => {
    mockUseAiAnswerStream.mockReset();
  });

  it('maps a known reason to copy and never renders the enum value', () => {
    abstainedWith('validation_failed');

    render(<AiSummaryResults query="maritime salvage" />);

    expect(
      screen.getByText(
        'The draft answer could not be traced back to a source, so it was withheld.',
      ),
    ).toBeInTheDocument();
    // The reason is a wire identifier. It selects copy; it is never shown.
    expect(document.body.textContent).not.toContain('validation_failed');
  });

  it('falls back to the generic copy for an unrecognised reason', () => {
    // A reason added server-side must degrade, not leak an identifier.
    abstainedWith('some_future_reason');

    render(<AiSummaryResults query="maritime salvage" />);

    expect(screen.getByText(ABSTENTION_FALLBACK)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('some_future_reason');
  });

  it('falls back to the generic copy when no reason is given', () => {
    abstainedWith(undefined);

    render(<AiSummaryResults query="maritime salvage" />);

    expect(screen.getByText(ABSTENTION_FALLBACK)).toBeInTheDocument();
  });
});
