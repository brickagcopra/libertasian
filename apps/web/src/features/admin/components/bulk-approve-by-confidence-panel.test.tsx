import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: { post: vi.fn() },
}));

import { apiClient } from '@/lib/api-client';
import { BulkApproveByConfidencePanel } from './bulk-approve-by-confidence-panel';

const mockPost = vi.mocked(apiClient.post);

function withProviders(children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockPost.mockReset();
});

describe('BulkApproveByConfidencePanel', () => {
  it('renders slider at default 0.70, all types selected, and the approve button disabled', () => {
    render(withProviders(<BulkApproveByConfidencePanel />));

    expect(screen.getByLabelText(/Confidence threshold/i)).toHaveValue('0.7');
    // Approve button is disabled until a preview has been fetched.
    const approveBtn = screen.getByRole('button', { name: /Approve/i });
    expect(approveBtn).toBeDisabled();
    // Preview button is enabled.
    expect(
      screen.getByRole('button', { name: /Preview counts/i }),
    ).not.toBeDisabled();
  });

  it('Preview counts calls the endpoint with dryRun=true and renders per-type breakdown', async () => {
    mockPost.mockResolvedValue({
      success: true,
      data: {
        dryRun: true,
        artifactsPromoted: 42,
        digestsPromoted: 7,
        subjectsInherited: 0,
        perTypeBreakdown: [
          { derivativeType: 'case_digest', count: 30 },
          { derivativeType: 'mcq_question', count: 12 },
        ],
        errors: [],
      },
    });

    render(withProviders(<BulkApproveByConfidencePanel />));
    await userEvent.click(
      screen.getByRole('button', { name: /Preview counts/i }),
    );

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/admin/derivatives/bulk-approve-by-confidence',
        expect.objectContaining({ dryRun: true, threshold: 0.7 }),
      );
    });

    expect(await screen.findByTestId('bulk-approve-preview')).toBeInTheDocument();
    expect(screen.getByText(/42 artifact\(s\), 7 digest\(s\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Case Digest: 30/i)).toBeInTheDocument();
    expect(screen.getByText(/MCQ Question: 12/i)).toBeInTheDocument();

    // Approve button now shows the total and is enabled.
    const approveBtn = screen.getByRole('button', { name: /Approve 49 items/i });
    expect(approveBtn).not.toBeDisabled();
  });

  it('Approve flow confirms then calls the endpoint with dryRun=false', async () => {
    // First call: preview
    mockPost.mockResolvedValueOnce({
      success: true,
      data: {
        dryRun: true,
        artifactsPromoted: 3,
        digestsPromoted: 1,
        subjectsInherited: 0,
        perTypeBreakdown: [{ derivativeType: 'case_digest', count: 3 }],
        errors: [],
      },
    });
    // Second call: real approve
    mockPost.mockResolvedValueOnce({
      success: true,
      data: {
        dryRun: false,
        artifactsPromoted: 3,
        digestsPromoted: 1,
        subjectsInherited: 2,
        perTypeBreakdown: [{ derivativeType: 'case_digest', count: 3 }],
        errors: [],
      },
    });

    render(withProviders(<BulkApproveByConfidencePanel />));

    await userEvent.click(
      screen.getByRole('button', { name: /Preview counts/i }),
    );
    await screen.findByTestId('bulk-approve-preview');

    await userEvent.click(
      screen.getByRole('button', { name: /Approve 4 items/i }),
    );
    // Confirmation dialog appears.
    const confirmBtn = await screen.findByRole('button', {
      name: /Confirm approve/i,
    });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockPost).toHaveBeenLastCalledWith(
        '/admin/derivatives/bulk-approve-by-confidence',
        expect.objectContaining({ dryRun: false, threshold: 0.7 }),
      );
    });

    expect(
      await screen.findByText(/Approved 3 artifact\(s\) and 1 digest\(s\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 subject assignment\(s\) inherited/i)).toBeInTheDocument();
  });

  it('Changing the threshold clears the previous preview', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: {
        dryRun: true,
        artifactsPromoted: 10,
        digestsPromoted: 0,
        subjectsInherited: 0,
        perTypeBreakdown: [{ derivativeType: 'case_digest', count: 10 }],
        errors: [],
      },
    });

    render(withProviders(<BulkApproveByConfidencePanel />));
    await userEvent.click(
      screen.getByRole('button', { name: /Preview counts/i }),
    );
    await screen.findByTestId('bulk-approve-preview');

    const slider = screen.getByLabelText(/Confidence threshold/i);
    // Range inputs can't be typed into — fire a change event directly.
    fireEvent.change(slider, { target: { value: '0.85' } });

    expect(screen.queryByTestId('bulk-approve-preview')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Approve$/i })).toBeDisabled();
  });
});
