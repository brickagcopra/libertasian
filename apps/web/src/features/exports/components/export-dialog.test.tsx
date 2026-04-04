import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockCreateExportMutateAsync = vi.fn();
const mockDownloadMutateAsync = vi.fn();
const mockReset = vi.fn();

vi.mock('../hooks/use-exports', () => ({
  useCreateExport: () => ({
    mutateAsync: mockCreateExportMutateAsync,
    isPending: false,
    error: null,
    reset: mockReset,
  }),
  useExport: () => ({ data: null }),
  useDownloadExport: () => ({
    mutateAsync: mockDownloadMutateAsync,
    isPending: false,
  }),
}));

import { ExportDialog } from './export-dialog';

describe('ExportDialog', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    contentType: 'digest' as const,
    contentId: 'd-1',
  };

  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when closed', () => {
    const { container } = render(
      <ExportDialog {...defaultProps} open={false} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog with title when open', () => {
    render(<ExportDialog {...defaultProps} />);
    expect(screen.getByText('Export Digest')).toBeInTheDocument();
  });

  it('renders subtitle when title prop provided', () => {
    render(<ExportDialog {...defaultProps} title="My Case Digest" />);
    expect(screen.getByText('My Case Digest')).toBeInTheDocument();
  });

  it('renders PDF and DOCX format options', () => {
    render(<ExportDialog {...defaultProps} />);
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('Word (DOCX)')).toBeInTheDocument();
  });

  it('has Export and Cancel buttons', () => {
    render(<ExportDialog {...defaultProps} />);
    expect(screen.getByText('Export')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('calls onClose when Cancel clicked', () => {
    const onClose = vi.fn();
    render(<ExportDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls createExport on Export click', async () => {
    mockCreateExportMutateAsync.mockResolvedValueOnce({ id: 'job-1' });
    render(<ExportDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Export'));

    await waitFor(() => {
      expect(mockCreateExportMutateAsync).toHaveBeenCalledWith({
        contentType: 'digest',
        contentId: 'd-1',
        format: 'pdf',
      });
    });
  });

  it('allows selecting DOCX format', () => {
    render(<ExportDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Word (DOCX)'));
    // DOCX button should now be selected (has blue border)
    const docxBtn = screen.getByText('Word (DOCX)').closest('button');
    expect(docxBtn?.className).toContain('border-blue-500');
  });

  it('closes backdrop when clicking overlay', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ExportDialog {...defaultProps} onClose={onClose} />,
    );
    const backdrop = container.querySelector('[aria-hidden="true"]');
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows correct label for memo content type', () => {
    render(
      <ExportDialog {...defaultProps} contentType="memo" />,
    );
    expect(screen.getByText('Export Memo')).toBeInTheDocument();
  });

  it('shows correct label for note content type', () => {
    render(
      <ExportDialog {...defaultProps} contentType="note" />,
    );
    expect(screen.getByText('Export Note')).toBeInTheDocument();
  });
});
