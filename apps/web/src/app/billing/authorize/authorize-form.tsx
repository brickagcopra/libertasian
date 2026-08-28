'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';

import { apiClient } from '@/lib/api-client';

/**
 * Card authorization step for gateways with no hosted subscription checkout.
 *
 * PayMongo creates a subscription in `incomplete` and only starts billing once
 * a payment method is attached to it. There is no PayMongo-hosted page for
 * that, so we collect the card here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PCI BOUNDARY — DO NOT MOVE THIS.
 *
 * The raw card (number, expiry, CVC) is POSTed from the BROWSER straight to
 * `https://api.paymongo.com/v1/payment_methods`, authenticated with the
 * PUBLISHABLE key. Card data never touches a LIBERTASIAN server, is never put
 * in our request logs, and is never persisted by us — that is precisely what
 * keeps this application out of full PCI-DSS scope (SAQ A-EP rather than SAQ D).
 *
 * Only the resulting opaque `pm_…` id is sent to our own API. If you ever find
 * yourself forwarding `card_number`, `cvc` or `exp_*` to `/api/v1/...`, stop:
 * that single change pulls the whole platform into full PCI scope.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** PayMongo tokenization endpoint. Called from the browser, never from our API. */
const PAYMONGO_PAYMENT_METHODS_URL = 'https://api.paymongo.com/v1/payment_methods';

interface PaymongoPaymentMethodResponse {
  data?: { id?: string };
  errors?: { detail?: string }[];
}

interface AuthorizeResponse {
  success: boolean;
  data: {
    status: 'requires_action' | 'pending_confirmation';
    nextActionUrl: string | null;
    subscriptionId: string;
  };
}

type Stage = 'form' | 'submitting' | 'pending';

const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-[#D8CEBC] bg-white px-4 py-3 text-base text-[#1C1A14] outline-none focus:border-[#1C1A14]';
const LABEL_CLASS = 'block text-sm font-medium text-[#5C5448]';

export function AuthorizeForm() {
  const searchParams = useSearchParams();
  const subscriptionRef = searchParams.get('ref') ?? '';
  const successUrl = searchParams.get('success') ?? '';
  const cancelUrl = searchParams.get('cancel') ?? '';
  // Set by the gateway when it sends the customer back from a 3DS step. There
  // is nothing left to collect at that point — the webhook decides the outcome.
  const returned = searchParams.get('returned') === '1';

  const [stage, setStage] = useState<Stage>(returned ? 'pending' : 'form');
  const [error, setError] = useState<string | null>(null);

  const [cardNumber, setCardNumber] = useState('');
  const [expMonth, setExpMonth] = useState('');
  const [expYear, setExpYear] = useState('');
  const [cvc, setCvc] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  /**
   * Tokenize the card at PayMongo, directly from this browser.
   * Returns the opaque payment-method id — the ONLY thing that may leave this
   * function.
   */
  async function createPaymentMethod(): Promise<string> {
    const publicKey = process.env['NEXT_PUBLIC_PAYMONGO_PUBLIC_KEY'] ?? '';
    if (!publicKey) {
      throw new Error('Card payments are not configured. Please contact support.');
    }

    const response = await fetch(PAYMONGO_PAYMENT_METHODS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${publicKey}:`)}`,
      },
      body: JSON.stringify({
        data: {
          attributes: {
            type: 'card',
            details: {
              card_number: cardNumber.replace(/\s+/g, ''),
              exp_month: Number(expMonth),
              exp_year: Number(expYear),
              cvc,
            },
            billing: { name, email },
          },
        },
      }),
    });

    const body = (await response.json()) as PaymongoPaymentMethodResponse;
    if (!response.ok || !body.data?.id) {
      throw new Error(body.errors?.[0]?.detail ?? 'We could not verify that card. Please check the details and try again.');
    }
    return body.data.id;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!subscriptionRef) {
      setError('This authorization link is incomplete. Please start checkout again.');
      return;
    }

    setStage('submitting');
    try {
      const paymentMethodId = await createPaymentMethod();

      // ONLY the opaque id crosses into our API. No card fields, ever.
      const result = await apiClient.post<AuthorizeResponse>('/billing/authorize', {
        subscriptionRef,
        paymentMethodId,
      });

      if (result.data.nextActionUrl) {
        // The bank wants a further step (3DS). Hand the customer over; the
        // gateway returns them to this page with ?returned=1.
        window.location.href = result.data.nextActionUrl;
        return;
      }

      // No further step. We deliberately do NOT claim the subscription is
      // active — the gateway webhook is what activates it, exactly as it is for
      // Xendit. Show a confirming state and let the user continue.
      setStage('pending');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setStage('form');
    }
  }

  if (stage === 'pending') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#F6F1E8] px-6 text-center text-[#1C1A14]">
        <h1 className="text-3xl" style={{ fontFamily: 'var(--font-display), Georgia, serif' }}>
          Confirming your subscription
        </h1>
        <p className="mt-3 max-w-sm text-base text-[#5C5448]">
          Your card is saved. We are waiting for your bank to confirm the first payment — this
          usually takes a few moments, and we will email you as soon as it clears.
        </p>
        {successUrl ? (
          <a
            href={successUrl}
            className="mt-8 inline-block rounded-full bg-[#1C1A14] px-8 py-4 text-base font-semibold text-[#F6F1E8]"
          >
            Continue
          </a>
        ) : null}
      </main>
    );
  }

  const submitting = stage === 'submitting';

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#F6F1E8] px-6 py-12 text-[#1C1A14]">
      <div className="w-full max-w-md">
        <h1
          className="text-center text-3xl"
          style={{ fontFamily: 'var(--font-display), Georgia, serif' }}
        >
          Authorize your card
        </h1>
        <p className="mt-3 text-center text-base text-[#5C5448]">
          Your card details go straight to our payment provider — they never reach LIBERTASIAN
          servers.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
          <div>
            <label className={LABEL_CLASS} htmlFor="card-number">
              Card number
            </label>
            <input
              id="card-number"
              name="card-number"
              className={FIELD_CLASS}
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="4343 4343 4343 4345"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={LABEL_CLASS} htmlFor="exp-month">
                Month
              </label>
              <input
                id="exp-month"
                name="exp-month"
                className={FIELD_CLASS}
                inputMode="numeric"
                autoComplete="cc-exp-month"
                placeholder="12"
                value={expMonth}
                onChange={(e) => setExpMonth(e.target.value)}
                required
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="exp-year">
                Year
              </label>
              <input
                id="exp-year"
                name="exp-year"
                className={FIELD_CLASS}
                inputMode="numeric"
                autoComplete="cc-exp-year"
                placeholder="2030"
                value={expYear}
                onChange={(e) => setExpYear(e.target.value)}
                required
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="cvc">
                CVC
              </label>
              <input
                id="cvc"
                name="cvc"
                className={FIELD_CLASS}
                inputMode="numeric"
                autoComplete="cc-csc"
                placeholder="123"
                value={cvc}
                onChange={(e) => setCvc(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="cardholder-name">
              Name on card
            </label>
            <input
              id="cardholder-name"
              name="cardholder-name"
              className={FIELD_CLASS}
              autoComplete="cc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="billing-email">
              Email
            </label>
            <input
              id="billing-email"
              name="billing-email"
              className={FIELD_CLASS}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-[#8B2F1D]">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full rounded-full bg-[#1C1A14] px-8 py-4 text-base font-semibold text-[#F6F1E8] disabled:opacity-60"
          >
            {submitting ? 'Authorizing…' : 'Authorize card'}
          </button>
        </form>

        {cancelUrl ? (
          <p className="mt-6 text-center text-sm">
            <a href={cancelUrl} className="text-[#5C5448] underline">
              Cancel and go back
            </a>
          </p>
        ) : null}
      </div>
    </main>
  );
}
