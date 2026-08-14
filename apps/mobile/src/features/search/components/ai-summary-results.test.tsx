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

const DOC = '2e2bad34-d194-4ddb-9e70-c9d0cd2ff388';
const SEC = 'f767e1bc-4578-4a85-a99b-6f9886af62d7';

/** A finished, cited answer exactly as the wire delivers it. */
function citedAnswer() {
  mockUseAiAnswerStream.mockReturnValue({
    text: `Sovereignty resides in the people [SOURCE ${DOC}§${SEC}]. It is **fundamental**.`,
    sources: [
      {
        document_id: DOC,
        section_id: SEC,
        title: '1987 Constitution',
        citation_text: 'Const. (1987)',
        relevance_score: 0.9,
        passage_text: 'Sovereignty resides in the people…',
      },
    ],
    isStreaming: false,
    isDone: true,
    error: null,
    confidence: 0.9,
    abstained: false,
    abstentionReason: null,
    retryCount: 0,
    reset: jest.fn(),
  });
}

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

  it('renders the no_results copy for a corpus-wide non-answer', () => {
    // Newly reachable: the model now answers INSUFFICIENT_SOURCES and the
    // pipeline abstains with `no_results` on a corpus-wide query instead of
    // rendering the refusal prose as an answer with a confidence badge.
    abstainedWith('no_results');

    render(<AiSummaryResults query="What is estafa under Philippine law?" />);

    expect(
      screen.getByText('No sources matched this question. Try different terms.'),
    ).toBeTruthy();
    expect(screen.queryByText(/no_results/)).toBeNull();
    expect(screen.queryByText(/INSUFFICIENT_SOURCES/)).toBeNull();
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

describe('AiSummaryResults citations', () => {
  afterEach(() => {
    mockUseAiAnswerStream.mockReset();
  });

  it('renders an inline [1] citation and never a raw SOURCE marker', () => {
    citedAnswer();

    const { toJSON } = render(<AiSummaryResults query="sovereignty" />);
    const rendered = JSON.stringify(toJSON());

    expect(screen.getByText(/Sovereignty resides in the people \[1\]/)).toBeTruthy();
    // The wire identifiers must not reach the reader anywhere on the screen.
    expect(rendered).not.toContain('SOURCE');
    expect(rendered).not.toContain(DOC);
    expect(rendered).not.toContain(SEC);
    // Markdown with no renderer is stripped, not shown literally.
    expect(rendered).not.toContain('**fundamental**');
  });

  it('numbers the source rows so [n] has something to point at', () => {
    citedAnswer();

    render(<AiSummaryResults query="sovereignty" />);

    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('1987 Constitution')).toBeTruthy();
  });
});
