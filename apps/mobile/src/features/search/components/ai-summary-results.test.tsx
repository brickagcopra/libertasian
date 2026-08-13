import { render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { View } = jest.requireActual('react-native') as typeof import('react-native');
  const MockReact = jest.requireActual('react') as typeof import('react');
  return {
    Ionicons: (props: Record<string, unknown>) =>
      MockReact.createElement(View, { testID: `icon-${props['name'] as string}` }),
  };
});

const mockUseAiAnswerStream = jest.fn();
jest.mock('../hooks/use-ai-answer-stream', () => ({
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
    reset: jest.fn(),
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
      screen.getByText('The draft answer could not be traced back to a source, so it was withheld.'),
    ).toBeTruthy();
    // The reason is a wire identifier. It selects copy; it is never shown.
    expect(screen.queryByText(/validation_failed/)).toBeNull();
  });

  it('falls back to the generic copy for an unrecognised reason', () => {
    // A reason added server-side must degrade, not leak an identifier.
    abstainedWith('some_future_reason');

    render(<AiSummaryResults query="maritime salvage" />);

    expect(screen.getByText(ABSTENTION_FALLBACK)).toBeTruthy();
    expect(screen.queryByText(/some_future_reason/)).toBeNull();
  });

  it('falls back to the generic copy when no reason is given', () => {
    abstainedWith(undefined);

    render(<AiSummaryResults query="maritime salvage" />);

    expect(screen.getByText(ABSTENTION_FALLBACK)).toBeTruthy();
  });
});
