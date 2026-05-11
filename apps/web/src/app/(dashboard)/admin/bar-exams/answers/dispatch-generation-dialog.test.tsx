import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { DispatchGenerationDialog } from './dispatch-generation-dialog';

function renderDialog(
  overrides?: Partial<React.ComponentProps<typeof DispatchGenerationDialog>>,
) {
  const props: React.ComponentProps<typeof DispatchGenerationDialog> = {
    open: true,
    isDispatching: false,
    errorMessage: null,
    onCancel: vi.fn(),
    onDispatch: vi.fn(),
    ...overrides,
  };
  render(<DispatchGenerationDialog {...props} />);
  return props;
}

describe('DispatchGenerationDialog', () => {
  it('returns null when not open', () => {
    const { container } = render(
      <DispatchGenerationDialog
        open={false}
        isDispatching={false}
        errorMessage={null}
        onCancel={() => {}}
        onDispatch={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders all three filter inputs and a 50-cap submit label', () => {
    renderDialog();
    expect(screen.getByLabelText(/Year/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Subject code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Sitting ID/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /Dispatch \(up to 50 questions\)/i,
      }),
    ).toBeInTheDocument();
  });

  it('disables submit while no filter is set', () => {
    renderDialog();
    const submit = screen.getByRole('button', { name: /Dispatch/ });
    expect(submit).toBeDisabled();
  });

  it('submits the filled-in filters via onDispatch', () => {
    const onDispatch = vi.fn();
    renderDialog({ onDispatch });

    fireEvent.change(screen.getByLabelText(/Year/i), { target: { value: '2018' } });
    fireEvent.change(screen.getByLabelText(/Subject code/i), {
      target: { value: 'criminal_law' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Dispatch/ }));

    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(onDispatch).toHaveBeenCalledWith({
      year: 2018,
      subjectCode: 'criminal_law',
      sittingId: undefined,
    });
  });

  it('shows dispatching state when isDispatching', () => {
    renderDialog({ isDispatching: true });
    fireEvent.change(screen.getByLabelText(/Year/i), { target: { value: '2018' } });
    expect(
      screen.getByRole('button', { name: /Dispatching/ }),
    ).toBeDisabled();
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
