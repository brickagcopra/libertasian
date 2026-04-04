import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockMutateAsync = vi.fn();
const mockReset = vi.fn();
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

let mockTemplates: unknown[] = [
  { id: 't1', name: 'Motion to Dismiss', description: 'Standard MTD', category: 'civil', court: 'RTC' },
  { id: 't2', name: 'Complaint', description: 'Civil complaint', category: 'civil', court: null },
];
let mockSelectedTemplate: unknown = null;

vi.mock('../hooks/use-pleadings', () => ({
  usePleadingTemplates: () => ({
    data: { data: mockTemplates },
    isLoading: false,
  }),
  usePleadingTemplate: () => ({
    data: mockSelectedTemplate,
  }),
  useGeneratePleading: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    error: null,
    reset: mockReset,
  }),
}));

vi.mock('../types', () => ({
  PLEADING_CATEGORY_LABELS: {
    civil: 'Civil',
    criminal: 'Criminal',
    labor: 'Labor',
  },
}));

import { GeneratePleadingDialog } from './generate-pleading-dialog';

describe('GeneratePleadingDialog', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockReset.mockReset();
    mockPush.mockReset();
    defaultProps.onClose.mockReset();
    mockSelectedTemplate = null;
    mockTemplates = [
      { id: 't1', name: 'Motion to Dismiss', description: 'Standard MTD', category: 'civil', court: 'RTC' },
      { id: 't2', name: 'Complaint', description: 'Civil complaint', category: 'civil', court: null },
    ];
  });

  it('renders nothing when open is false', () => {
    const { container } = render(
      <GeneratePleadingDialog open={false} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders template selection step', () => {
    render(<GeneratePleadingDialog {...defaultProps} />);
    expect(screen.getByText('Select Pleading Template')).toBeInTheDocument();
  });

  it('renders templates list', () => {
    render(<GeneratePleadingDialog {...defaultProps} />);
    expect(screen.getByText('Motion to Dismiss')).toBeInTheDocument();
    expect(screen.getByText('Complaint')).toBeInTheDocument();
  });

  it('renders category filter dropdown', () => {
    render(<GeneratePleadingDialog {...defaultProps} />);
    expect(screen.getByText('All Categories')).toBeInTheDocument();
    // 'Civil' appears in both the <option> and template category badges
    const civilTexts = screen.getAllByText('Civil');
    expect(civilTexts.length).toBeGreaterThanOrEqual(1);
  });

  it('shows template descriptions', () => {
    render(<GeneratePleadingDialog {...defaultProps} />);
    expect(screen.getByText('Standard MTD')).toBeInTheDocument();
  });

  it('renders Cancel button on template step', () => {
    render(<GeneratePleadingDialog {...defaultProps} />);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('shows no templates message when list is empty', () => {
    mockTemplates = [];
    render(<GeneratePleadingDialog {...defaultProps} />);
    expect(screen.getByText('No templates found for this category.')).toBeInTheDocument();
  });

  it('shows court info for templates with court', () => {
    render(<GeneratePleadingDialog {...defaultProps} />);
    expect(screen.getByText('RTC')).toBeInTheDocument();
  });
});
