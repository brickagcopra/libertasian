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
        missing: 137,
        replacingPending: 0,
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
      preview: {
        total: 10,
        missing: 10,
        replacingPending: 0,
        byYearSubject: [],
      },
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

  it('regenerate-pending is off by default and sends nothing when unchecked', () => {
    const onPreview = vi.fn();
    renderDialog({ onPreview });

    expect(screen.getByLabelText(/Also regenerate answers still pending/i)).not
      .toBeChecked();
    expect(screen.queryByLabelText(/Only below confidence/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/Year/i), { target: { value: '2018' } });
    fireEvent.click(screen.getByRole('button', { name: /Check count/i }));

    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        regeneratePending: undefined,
        maxConfidence: undefined,
      }),
    );
  });

  it('sends the confidence ceiling only alongside regeneratePending', () => {
    const onPreview = vi.fn();
    renderDialog({ onPreview });

    fireEvent.change(screen.getByLabelText(/Year/i), { target: { value: '2018' } });
    fireEvent.click(screen.getByLabelText(/Also regenerate answers still pending/i));
    fireEvent.change(screen.getByLabelText(/Only below confidence/i), {
      target: { value: '0.7' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Check count/i }));

    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({ regeneratePending: true, maxConfidence: 0.7 }),
    );
  });

  it('blocks submit on an out-of-range confidence ceiling', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/Year/i), { target: { value: '2018' } });
    fireEvent.click(screen.getByLabelText(/Also regenerate answers still pending/i));
    fireEvent.change(screen.getByLabelText(/Only below confidence/i), {
      target: { value: '1.4' },
    });
    expect(screen.getByRole('button', { name: /Check count/i })).toBeDisabled();
  });

  it('the confirm text names the replaced count and spares approved answers', () => {
    renderDialog({
      preview: {
        total: 40,
        missing: 12,
        replacingPending: 28,
        byYearSubject: [],
      },
    });

    expect(screen.getByText(/40 questions will be generated/i)).toBeInTheDocument();
    expect(
      screen.getByText(/28 of them replace an answer still pending review/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/12 have no answer yet/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Approved and rejected answers are never touched/i).length,
    ).toBeGreaterThan(0);
  });

  it('shows the queueing state while dispatching', () => {
    renderDialog({
      isDispatching: true,
      preview: { total: 4, missing: 4, replacingPending: 0, byYearSubject: [] },
    });
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
