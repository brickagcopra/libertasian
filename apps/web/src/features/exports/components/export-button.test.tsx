import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockCreateExportMutateAsync = vi.fn();
const mockDownloadMutateAsync = vi.fn();

vi.mock('../hooks/use-exports', () => ({
  useCreateExport: () => ({
    mutateAsync: mockCreateExportMutateAsync,
    isPending: false,
    error: null,
  }),
  useExport: () => ({ data: null }),
  useDownloadExport: () => ({
    mutateAsync: mockDownloadMutateAsync,
    isPending: false,
  }),
}));

// Mock Radix dropdown to render inline (avoids portal rendering issues in happy-dom)
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <div role="menuitem" onClick={onClick}>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

import { ExportButton } from './export-button';

describe('ExportButton', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders export button with dropdown', () => {
    render(<ExportButton contentType="digest" contentId="d-1" />);
    expect(screen.getByText('Export')).toBeInTheDocument();
  });

  it('shows PDF and DOCX options', () => {
    render(<ExportButton contentType="digest" contentId="d-1" />);
    expect(screen.getByText('Export as PDF')).toBeInTheDocument();
    expect(screen.getByText('Export as Word (DOCX)')).toBeInTheDocument();
  });

  it('calls createExport with PDF format', async () => {
    mockCreateExportMutateAsync.mockResolvedValueOnce({ id: 'job-1' });
    render(<ExportButton contentType="digest" contentId="d-1" />);
    fireEvent.click(screen.getByText('Export as PDF'));

    await waitFor(() => {
      expect(mockCreateExportMutateAsync).toHaveBeenCalledWith({
        contentType: 'digest',
        contentId: 'd-1',
        format: 'pdf',
      });
    });
  });

  it('calls createExport with DOCX format', async () => {
    mockCreateExportMutateAsync.mockResolvedValueOnce({ id: 'job-2' });
    render(<ExportButton contentType="memo" contentId="m-1" />);
    fireEvent.click(screen.getByText('Export as Word (DOCX)'));

    await waitFor(() => {
      expect(mockCreateExportMutateAsync).toHaveBeenCalledWith({
        contentType: 'memo',
        contentId: 'm-1',
        format: 'docx',
      });
    });
  });
});
