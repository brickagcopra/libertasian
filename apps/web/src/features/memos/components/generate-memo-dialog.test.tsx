import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockMutateAsync = vi.fn();
const mockReset = vi.fn();
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('../hooks/use-memos', () => ({
  useGenerateMemo: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    error: null,
    reset: mockReset,
  }),
}));

vi.mock('../types', () => ({
  MEMO_TYPE_LABELS: {
    legal_opinion: 'Legal Opinion',
    case_analysis: 'Case Analysis',
  },
}));

import { GenerateMemoDialog } from './generate-memo-dialog';

describe('GenerateMemoDialog', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockReset.mockReset();
    mockPush.mockReset();
    defaultProps.onClose.mockReset();
  });

  it('renders nothing when open is false', () => {
    const { container } = render(
      <GenerateMemoDialog open={false} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog title and description', () => {
    render(<GenerateMemoDialog {...defaultProps} />);
    expect(screen.getByText('Generate Legal Memo')).toBeInTheDocument();
    expect(screen.getByText(/Describe your research question/)).toBeInTheDocument();
  });

  it('renders research question textarea', () => {
    render(<GenerateMemoDialog {...defaultProps} />);
    expect(screen.getByLabelText('Research Question')).toBeInTheDocument();
  });

  it('renders memo type select with options', () => {
    render(<GenerateMemoDialog {...defaultProps} />);
    expect(screen.getByLabelText('Memo Type')).toBeInTheDocument();
    expect(screen.getByText('Legal Opinion')).toBeInTheDocument();
    expect(screen.getByText('Case Analysis')).toBeInTheDocument();
  });

  it('shows character count', () => {
    render(<GenerateMemoDialog {...defaultProps} />);
    expect(screen.getByText('0/2000 characters (minimum 10)')).toBeInTheDocument();
  });

  it('disables submit button when query is too short', () => {
    render(<GenerateMemoDialog {...defaultProps} />);
    const submitBtn = screen.getByText('Generate Memo');
    expect(submitBtn).toBeDisabled();
  });

  it('enables submit button when query is long enough', () => {
    render(<GenerateMemoDialog {...defaultProps} />);
    const textarea = screen.getByLabelText('Research Question');
    fireEvent.change(textarea, {
      target: { value: 'What are the requirements for constructive dismissal?' },
    });
    const submitBtn = screen.getByText('Generate Memo');
    expect(submitBtn).not.toBeDisabled();
  });

  it('renders matter select when matters are provided', () => {
    render(
      <GenerateMemoDialog
        {...defaultProps}
        matters={[{ id: 'm1', title: 'Test Matter' }]}
      />,
    );
    expect(screen.getByText('Test Matter')).toBeInTheDocument();
  });

  it('does not render matter select when no matters', () => {
    render(<GenerateMemoDialog {...defaultProps} />);
    expect(screen.queryByText('Link to Matter')).not.toBeInTheDocument();
  });

  it('renders Cancel button', () => {
    render(<GenerateMemoDialog {...defaultProps} />);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });
});
