'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { useVerifyEmail, useResendVerification } from '@/features/auth/hooks/use-auth';
import { ApiClientError } from '@/lib/api-client';
import { APP_NAME, ROUTES } from '@/lib/constants';

type VerifyState = 'input' | 'verifying' | 'success' | 'error' | 'no-email';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get('email');
  const verifyEmail = useVerifyEmail();
  const resendVerification = useResendVerification();

  const [state, setState] = useState<VerifyState>(email ? 'input' : 'no-email');
  const [errorMessage, setErrorMessage] = useState('');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [resendCountdown, setResendCountdown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Countdown timer for resend
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setTimeout(() => setResendCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  const handleSubmit = useCallback(async (code: string) => {
    if (!email || code.length !== 6) return;
    setState('verifying');
    setErrorMessage('');

    try {
      await verifyEmail.mutateAsync({ email, code });
      setState('success');
    } catch (error: unknown) {
      setState('error');
      if (error instanceof ApiClientError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('Failed to verify email. Please try again.');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const handleDigitChange = (index: number, value: string) => {
    // Only allow numeric input
    const digit = value.replace(/\D/g, '').slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);

    // Auto-advance to next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits are entered
    const code = newDigits.join('');
    if (code.length === 6 && newDigits.every((d) => d !== '')) {
      handleSubmit(code);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 0) return;

    const newDigits = [...digits];
    for (let i = 0; i < pasted.length && i < 6; i++) {
      newDigits[i] = pasted[i];
    }
    setDigits(newDigits);

    // Focus the next empty input or last
    const nextEmpty = newDigits.findIndex((d) => d === '');
    inputRefs.current[nextEmpty === -1 ? 5 : nextEmpty]?.focus();

    if (pasted.length === 6) {
      handleSubmit(pasted);
    }
  };

  const handleResend = async () => {
    if (!email || resendCountdown > 0) return;
    try {
      await resendVerification.mutateAsync({ email });
      setResendCountdown(60);
      setErrorMessage('');
      setState('input');
      setDigits(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } catch (error: unknown) {
      if (error instanceof ApiClientError) {
        setErrorMessage(error.message);
      }
    }
  };

  if (state === 'no-email') {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-yellow-50 p-4 text-sm text-yellow-700">
          No email address provided. Please register first.
        </div>
        <p className="text-center text-sm text-gray-600">
          <Link href={ROUTES.LOGIN} className="font-medium text-gray-900 hover:text-gray-700">
            Go to sign in
          </Link>
        </p>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-green-50 p-4 text-sm text-green-700">
          Your email has been verified successfully. You can now sign in.
        </div>
        <p className="text-center">
          <Link
            href={ROUTES.LOGIN}
            className="inline-flex rounded-md bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-gray-800"
          >
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-sm text-gray-600">
          We sent a 6-digit code to
        </p>
        <p className="font-medium text-gray-900">{email}</p>
      </div>

      {(state === 'error') && errorMessage && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      <div className="flex justify-center gap-2" onPaste={handlePaste}>
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleDigitChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            disabled={state === 'verifying'}
            className="h-14 w-11 rounded-lg border border-gray-300 text-center text-2xl font-bold text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:opacity-50"
            autoFocus={i === 0}
          />
        ))}
      </div>

      {state === 'verifying' && (
        <div className="flex justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-800" />
        </div>
      )}

      <p className="text-center text-sm text-gray-600">
        {"Didn't receive the code? "}
        {resendCountdown > 0 ? (
          <span className="text-gray-400">Resend in {resendCountdown}s</span>
        ) : (
          <button
            type="button"
            onClick={handleResend}
            className="font-medium text-gray-900 hover:text-gray-700"
            disabled={resendVerification.isPending}
          >
            {resendVerification.isPending ? 'Sending...' : 'Resend code'}
          </button>
        )}
      </p>

      <p className="text-center text-xs text-gray-500">
        Code expires in 15 minutes.
      </p>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            {APP_NAME}
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Verify your email
          </p>
        </div>
        <Suspense fallback={
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-800" />
          </div>
        }>
          <VerifyEmailContent />
        </Suspense>
      </div>
    </main>
  );
}
