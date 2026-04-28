import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  PlanPreviewDialog,
  type PlanItemizedColumn,
  type PlanItemizedRow,
} from './plan-preview-dialog';

const baseProps = {
  open: true,
  title: 'Backfill X',
  isLoadingPlan: false,
  planError: null,
  isDispatching: false,
  summarySlots: [
    { label: 'Total', value: 100 },
    { label: 'Pending', value: 25 },
  ],
  primaryActionLabel: 'Dispatch 25',
  onCancel: vi.fn(),
  onPrimaryAction: vi.fn(),
};

describe('PlanPreviewDialog', () => {
  it('renders the title, summary slots, and primary action', () => {
    render(<PlanPreviewDialog {...baseProps} onCancel={vi.fn()} onPrimaryAction={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Backfill X' })).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dispatch 25' })).toBeInTheDocument();
  });

  it('renders itemized rows with a sticky-footer dispatch button', () => {
    const rows: PlanItemizedRow[] = [
      {
        key: 'a',
        label: 'Essay Prompt',
        status: 'pending',
        count: 5,
        selected: true,
        ariaLabel: 'Include Essay Prompt',
      },
      {
        key: 'b',
        label: 'MCQ Question',
        status: 'done',
        statusLabel: 'Ingested',
        count: 12,
        selectable: false,
        ariaLabel: 'Include MCQ Question',
      },
    ];
    const columns: PlanItemizedColumn[] = [
      { key: 'select', header: 'Include' },
      { key: 'label', header: 'Type' },
      { key: 'count', header: 'Count' },
      { key: 'status', header: 'Status' },
    ];
    render(
      <PlanPreviewDialog
        {...baseProps}
        itemizedRows={rows}
        itemizedColumns={columns}
        onCancel={vi.fn()}
        onPrimaryAction={vi.fn()}
      />,
    );
    expect(screen.getByText('Essay Prompt')).toBeInTheDocument();
    expect(screen.getByText('MCQ Question')).toBeInTheDocument();
    // Selectable row gets a checkbox; the done row's checkbox is disabled.
    const essay = screen.getByLabelText('Include Essay Prompt') as HTMLInputElement;
    const mcq = screen.getByLabelText('Include MCQ Question') as HTMLInputElement;
    expect(essay.checked).toBe(true);
    expect(mcq.disabled).toBe(true);
  });

  it('shows a loading state when isLoadingPlan is true', () => {
    render(
      <PlanPreviewDialog
        {...baseProps}
        isLoadingPlan
        onCancel={vi.fn()}
        onPrimaryAction={vi.fn()}
      />,
    );
    expect(screen.getByText(/Loading plan/i)).toBeInTheDocument();
  });

  it('shows an error state when planError is provided', () => {
    render(
      <PlanPreviewDialog
        {...baseProps}
        planError="boom"
        onCancel={vi.fn()}
        onPrimaryAction={vi.fn()}
      />,
    );
    expect(screen.getByText(/Failed to load plan: boom/)).toBeInTheDocument();
  });

  it('invokes onCancel and onPrimaryAction', () => {
    const onCancel = vi.fn();
    const onPrimaryAction = vi.fn();
    render(
      <PlanPreviewDialog
        {...baseProps}
        onCancel={onCancel}
        onPrimaryAction={onPrimaryAction}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch 25' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onPrimaryAction).toHaveBeenCalledTimes(1);
  });

  it('returns null when not open', () => {
    const { container } = render(
      <PlanPreviewDialog
        {...baseProps}
        open={false}
        onCancel={vi.fn()}
        onPrimaryAction={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
