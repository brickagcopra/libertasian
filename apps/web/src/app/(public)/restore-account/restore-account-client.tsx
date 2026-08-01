'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { useRestoreAccount } from '@/features/settings/hooks/use-settings';
import { ApiClientError } from '@/lib/api-client';

type State = 'restoring' | 'restored' | 'invalid' | 'error';

export function RestoreAccountClient() {
  const restore = useRestoreAccount();

  const [state, setState] = useState<State>('restoring');
  const [message, setMessage] = useState('');
  // The token is single-use, so a second POST answers 400 and would flip a
  // successful restore into an error screen. StrictMode double-invokes effects
  // in development, so guard the attempt rather than relying on effect timing.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    // Read from window rather than useSearchParams: this page has no Suspense
    // boundary and must stay statically prerenderable.
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setState('invalid');
      return;
    }

    restore
      .mutateAsync(token)
      .then(() => setState('restored'))
      .catch((error: unknown) => {
        if (error instanceof ApiClientError) {
          setMessage(error.message);
          setState('invalid');
        } else {
          setMessage('We could not reach the server. Please try again.');
          setState('error');
        }
      });
    // `restore` is a stable mutation object; re-running on it would defeat the
    // single-attempt guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'restoring') {
    return (
      <Panel title="Restoring your account…">
        <p>Hang on while we bring everything back.</p>
      </Panel>
    );
  }

  if (state === 'restored') {
    return (
      <Panel title="Your account is back" tone="success">
        <p>
          Your account has been restored and nothing was deleted. You can sign
          in again with the same credentials.
        </p>
        <p className="mt-4">
          <Link
            href="/login"
            className="inline-block rounded-md bg-amber-700 px-4 py-2 font-medium text-white hover:bg-amber-800"
          >
            Sign in
          </Link>
        </p>
      </Panel>
    );
  }

  if (state === 'error') {
    return (
      <Panel title="Something went wrong" tone="error">
        <p>{message}</p>
        <p className="mt-4 text-gray-600">
          If this keeps happening, email{' '}
          <strong>dpo@libertasian.com</strong> from your account address before
          the 30-day window closes.
        </p>
      </Panel>
    );
  }

  // 'invalid' — no token in the URL, already used, expired, or already purged.
  return (
    <Panel title="This restore link no longer works" tone="error">
      <p>
        {message ||
          'The link is missing its token. Use the full link from the email we sent you.'}
      </p>
      <p className="mt-4 text-gray-600">
        Restore links can be used once and expire 30 days after the deletion
        request. If your account has already been permanently deleted it cannot
        be recovered. For anything else, email{' '}
        <strong>dpo@libertasian.com</strong>.
      </p>
      <p className="mt-4">
        <Link href="/account-deletion" className="text-amber-700 underline">
          Read our deletion policy
        </Link>
      </p>
    </Panel>
  );
}

function Panel({
  title,
  tone = 'neutral',
  children,
}: {
  title: string;
  tone?: 'neutral' | 'success' | 'error';
  children: React.ReactNode;
}) {
  const border =
    tone === 'success'
      ? 'border-green-200'
      : tone === 'error'
        ? 'border-red-200'
        : 'border-gray-200';

  return (
    <div className={`rounded-lg border ${border} p-8`}>
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      <div className="mt-4 text-sm leading-relaxed text-gray-700">
        {children}
      </div>
    </div>
  );
}
