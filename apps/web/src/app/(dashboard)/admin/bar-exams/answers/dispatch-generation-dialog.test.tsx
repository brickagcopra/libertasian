import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { DispatchGenerationDialog } from './dispatch-generation-dialog';

function renderDialog(
  overrides?: Partial<React.ComponentProps<typeof DispatchGenerationDialog>>,
) {
  const props: React.ComponentProps<typeof DispatchGenerationDialog> = {
    open: true,
    isChecking: false,
    isDispatching: false,
    preview: null,
    errorMessage: null,
    onCancel: vi.fn(),
    onPreview: vi.fn(),
    onConfirm: vi.fn(),
    onResetPreview: vi.fn(),
    ...overrides,
  };
  const view = render(<DispatchGenerationDialog {...props} />);
  return { props, view };
}

describe('DispatchGenerationDialog', () => {
  it('returns null when not open', () => {
    const { container } = render(
      <DispatchGenerationDialog
        open={false}
        isChecking={false}
        isDispatching={false}
        preview={null}
        errorMessage={null}
        onCancel={() => {}}
        onPreview={() => {}}
        onConfirm={() => {}}
        onResetPreview={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the filter inputs and offers a count check, not a 50 cap', () => {
    renderDialog();
    expect(screen.getByLabelText(/Year/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Subject code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Sitting ID/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Check count/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/50/)).not.toBeInTheDocument();
  });

  it('disables submit while no filter is set', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: /Check count/i })).toBeDisabled();
  });

  it('first submit runs the dry run, never the dispatch', () => {
    const onPreview = vi.fn();
    const onConfirm = vi.fn();
    renderDialog({ onPreview, onConfirm });

    fireEvent.change(screen.getByLabelText(/Year/i), { target: { value: '2018' } });
    fireEvent.change(screen.getByLabelText(/Subject code/i), {
      target: { value: 'criminal_law' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Check count/i }));

    expect(onPreview).toHaveBeenCalledWith({
      year: 2018,
      subjectCode: 'criminal_law',
      sittingId: undefined,
      allMissing: undefined,
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows the resolved count and only then confirms', () => {
    const onConfirm = vi.fn();
    renderDialog({
      onConfirm,
      preview: {
        total: 137,
        byYearSubject: [{ year: 2018, subjectCode: 'civil_law', count: 137 }],
      },
    });

    fireEvent.change(screen.getByLabelText(/Year/i), { target: { value: '2018' } });
    expect(
      screen.getByText(/137 questions will be generated/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Confirm — generate 137/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('drops a stale preview when a filter changes under it', () => {
    const onResetPreview = vi.fn();
    renderDialog({
      onResetPreview,
      preview: { total: 10, byYearSubject: [] },
    });

    fireEvent.change(screen.getByLabelText(/Subject code/i), {
      target: { value: 'tax' },
    });
    expect(onResetPreview).toHaveBeenCalledTimes(1);
  });

  it('the all-missing checkbox is a filter of its own', () => {
    const onPreview = vi.fn();
    renderDialog({ onPreview });

    fireEvent.click(screen.getByLabelText(/Every unanswered question/i));
    fireEvent.click(screen.getByRole('button', { name: /Check count/i }));

    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({ allMissing: true }),
    );
  });

  it('shows the queueing state while dispatching', () => {
    renderDialog({ isDispatching: true, preview: { total: 4, byYearSubject: [] } });
    fireEvent.change(screen.getByLabelText(/Year/i), { target: { value: '2018' } });
    expect(screen.getByRole('button', { name: /Queueing/ })).toBeDisabled();
  });

  it('surfaces error message when provided', () => {
    renderDialog({ errorMessage: 'boom' });
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('invokes onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
