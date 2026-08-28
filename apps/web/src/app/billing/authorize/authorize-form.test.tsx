import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const postMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: (...args: unknown[]) => postMock(...args),
  },
}));

let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/billing/authorize',
  useParams: () => ({}),
}));

import { AuthorizeForm } from './authorize-form';

const SUB_REF = '6d5a4e3c-2b1f-4a8e-9c7d-5e4f3a2b1c0d';

function setParams(params: Record<string, string>) {
  searchParams = new URLSearchParams(params);
}

function fillCard() {
  fireEvent.change(screen.getByLabelText('Card number'), {
    target: { value: '4343 4343 4343 4345' },
  });
  fireEvent.change(screen.getByLabelText('Month'), { target: { value: '12' } });
  fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2030' } });
  fireEvent.change(screen.getByLabelText('CVC'), { target: { value: '917' } });
  fireEvent.change(screen.getByLabelText('Name on card'), { target: { value: 'Juan Dela Cruz' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'juan@example.com' } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Authorize card' }));
}

/** PayMongo tokenization succeeds and hands back an opaque pm_ id. */
function mockTokenizationOk(id = 'pm_abc123') {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ data: { id } }),
  }) as unknown as typeof fetch;
}

describe('billing authorize form', () => {
  beforeEach(() => {
    cleanup();
    postMock.mockReset();
    process.env['NEXT_PUBLIC_PAYMONGO_PUBLIC_KEY'] = 'pk_test_public_key';
    setParams({
      ref: SUB_REF,
      success: 'https://app.test/billing/success',
      cancel: 'https://app.test/pricing',
    });
    window.location.href = 'https://app.test/billing/authorize';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the card fields', () => {
    render(<AuthorizeForm />);

    expect(screen.getByLabelText('Card number')).toBeTruthy();
    expect(screen.getByLabelText('Month')).toBeTruthy();
    expect(screen.getByLabelText('Year')).toBeTruthy();
    expect(screen.getByLabelText('CVC')).toBeTruthy();
    expect(screen.getByLabelText('Name on card')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });

  it('posts the raw card straight to PayMongo with the publishable key', async () => {
    mockTokenizationOk();
    postMock.mockResolvedValue({
      success: true,
      data: { status: 'pending_confirmation', nextActionUrl: null, subscriptionId: SUB_REF },
    });

    render(<AuthorizeForm />);
    fillCard();
    submit();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.paymongo.com/v1/payment_methods');
    expect(init.headers.Authorization).toBe(`Basic ${btoa('pk_test_public_key:')}`);
    expect(JSON.parse(init.body as string)).toEqual({
      data: {
        attributes: {
          type: 'card',
          details: {
            // Spaces stripped from the typed number.
            card_number: '4343434343434345',
            exp_month: 12,
            exp_year: 2030,
            cvc: '917',
          },
          billing: { name: 'Juan Dela Cruz', email: 'juan@example.com' },
        },
      },
    });
  });

  // THE PCI BOUNDARY TEST. Card data reaching our own API would pull the whole
  // platform into full PCI scope, so assert the payload EXACTLY — an added
  // field must fail this test, not slip through.
  it('sends our own API only { subscriptionRef, paymentMethodId } — never card data', async () => {
    mockTokenizationOk('pm_abc123');
    postMock.mockResolvedValue({
      success: true,
      data: { status: 'pending_confirmation', nextActionUrl: null, subscriptionId: SUB_REF },
    });

    render(<AuthorizeForm />);
    fillCard();
    submit();

    await waitFor(() => expect(postMock).toHaveBeenCalled());

    const [endpoint, body] = postMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(endpoint).toBe('/billing/authorize');
    expect(body).toEqual({ subscriptionRef: SUB_REF, paymentMethodId: 'pm_abc123' });
    expect(Object.keys(body).sort()).toEqual(['paymentMethodId', 'subscriptionRef']);

    // Belt and braces: no card value may appear anywhere in what we sent.
    const serialized = JSON.stringify(body);
    for (const secret of ['4343434343434345', '4343 4343 4343 4345', '917', '2030']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('redirects to the gateway next action when one is required', async () => {
    mockTokenizationOk();
    postMock.mockResolvedValue({
      success: true,
      data: {
        status: 'requires_action',
        nextActionUrl: 'https://paymongo.test/3ds/abc',
        subscriptionId: SUB_REF,
      },
    });

    render(<AuthorizeForm />);
    fillCard();
    submit();

    await waitFor(() => expect(window.location.href).toBe('https://paymongo.test/3ds/abc'));
  });

  it('shows a confirming state without claiming activation when no next action is issued', async () => {
    mockTokenizationOk();
    postMock.mockResolvedValue({
      success: true,
      data: { status: 'pending_confirmation', nextActionUrl: null, subscriptionId: SUB_REF },
    });

    render(<AuthorizeForm />);
    fillCard();
    submit();

    await waitFor(() => expect(screen.getByText('Confirming your subscription')).toBeTruthy());
    // The webhook activates the subscription, so the page must not navigate
    // away to a success page on its own or announce that the plan is live.
    expect(window.location.href).toBe('https://app.test/billing/authorize');
    expect(screen.queryByText(/subscription is active/i)).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Continue' }).getAttribute('href'),
    ).toBe('https://app.test/billing/success');
  });

  it('goes straight to the confirming state when the gateway returns from 3DS', () => {
    setParams({ ref: SUB_REF, success: 'https://app.test/billing/success', returned: '1' });

    render(<AuthorizeForm />);

    expect(screen.getByText('Confirming your subscription')).toBeTruthy();
    expect(screen.queryByLabelText('Card number')).toBeNull();
  });

  it('surfaces a tokenization failure and never calls our API', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ errors: [{ detail: 'Card number is invalid.' }] }),
    }) as unknown as typeof fetch;

    render(<AuthorizeForm />);
    fillCard();
    submit();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Card number is invalid.'));
    expect(postMock).not.toHaveBeenCalled();
    // The form stays available for a retry.
    expect(screen.getByRole('button', { name: 'Authorize card' })).toBeTruthy();
  });

  it('refuses to submit an authorization link with no subscription ref', async () => {
    setParams({ success: 'https://app.test/billing/success' });
    global.fetch = vi.fn() as unknown as typeof fetch;

    render(<AuthorizeForm />);
    fillCard();
    submit();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(global.fetch).not.toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('fails closed when the publishable key is missing from the build', async () => {
    delete process.env['NEXT_PUBLIC_PAYMONGO_PUBLIC_KEY'];
    global.fetch = vi.fn() as unknown as typeof fetch;

    render(<AuthorizeForm />);
    fillCard();
    submit();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(global.fetch).not.toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('offers a cancel link back to the checkout entry point', () => {
    render(<AuthorizeForm />);

    expect(
      screen.getByRole('link', { name: 'Cancel and go back' }).getAttribute('href'),
    ).toBe('https://app.test/pricing');
  });
});
