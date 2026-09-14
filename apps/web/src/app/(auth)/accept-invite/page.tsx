'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useAcceptInvite, useInviteLookup } from '@/features/auth/hooks/use-auth';
import { ApiClientError } from '@/lib/api-client';
import { Wordmark } from '@/components/brand/wordmark';
import { ROUTES } from '@/lib/constants';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Landing page for the `Accept Invitation` link in the organization invite
 * email (`/accept-invite?token=…`). Public: the invitee may have no account at
 * all, so this page cannot sit behind the session gate — see PUBLIC_PATHS in
 * src/middleware.ts.
 *
 * It looks the invite up first so the invitee sees which organization and role
 * they are being offered, and so an expired or already-used token can be
 * explained in plain language rather than failing at the POST.
 */
function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const lookup = useInviteLookup(token);
  const acceptInvite = useAcceptInvite();
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState('');

  // Return here after registering or signing in, so the invite is accepted
  // with the session the invitee has just obtained.
  const returnTo = `${ROUTES.ACCEPT_INVITE}?token=${encodeURIComponent(token)}`;

  const handleAccept = async () => {
    setAcceptError('');
    try {
      await acceptInvite.mutateAsync({ token });
      setAccepted(true);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setAcceptError(
          error.statusCode === 409
            ? 'You are already a member of this organization.'
            : error.message,
        );
      } else {
        setAcceptError('Something went wrong. Please try again.');
      }
    }
  };

  if (!token) {
    return (
      <Alert>
        <AlertDescription>
          This link is missing its invitation code. Please open the
          &ldquo;Accept Invitation&rdquo; link in your email again, or ask
          whoever invited you to send a new one.
        </AlertDescription>
      </Alert>
    );
  }

  if (lookup.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (lookup.isError) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            We couldn&rsquo;t find this invitation. It may have already been
            used, or the link may have been cut short by your email app. Ask
            whoever invited you to send a new invitation.
          </AlertDescription>
        </Alert>
        <p className="text-center text-sm text-warm-ink-mid">
          <Link href={ROUTES.LOGIN} className="font-medium text-warm-ink hover:underline">
            Go to sign in
          </Link>
        </p>
      </div>
    );
  }

  const invite = lookup.data;

  if (invite.accepted) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            This invitation to <strong>{invite.organizationName}</strong> has
            already been used. If that was you, just sign in — you&rsquo;re
            already a member.
          </AlertDescription>
        </Alert>
        <Button
          asChild
          className="h-12 w-full rounded-full bg-warm-ink text-warm-cream hover:bg-warm-ink/90"
        >
          <Link href={ROUTES.LOGIN}>Sign in</Link>
        </Button>
      </div>
    );
  }

  if (invite.expired) {
    return (
      <Alert>
        <AlertDescription>
          This invitation to <strong>{invite.organizationName}</strong> has
          expired. Invitations are good for 7 days — ask whoever invited you to
          send a new one.
        </AlertDescription>
      </Alert>
    );
  }

  if (accepted) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            You&rsquo;ve joined <strong>{invite.organizationName}</strong> as{' '}
            <strong>{invite.role}</strong>.
          </AlertDescription>
        </Alert>
        <Button
          asChild
          className="h-12 w-full rounded-full bg-warm-ink text-warm-cream hover:bg-warm-ink/90"
        >
          <Link href={ROUTES.SEARCH}>Continue</Link>
        </Button>
      </div>
    );
  }

  const summary = (
    <p className="text-sm text-warm-ink-mid">
      You&rsquo;ve been invited to join{' '}
      <strong className="text-warm-ink">{invite.organizationName}</strong> as{' '}
      <strong className="text-warm-ink">{invite.role}</strong>.
    </p>
  );

  // No session yet: the accept call needs a JWT. New invitees register with the
  // invited email prefilled; the `from` chain carries them back here afterwards.
  if (!isAuthenticated) {
    return (
      <div className="space-y-6">
        {summary}
        <p className="text-sm text-warm-ink-mid">
          Sign in as <strong className="text-warm-ink">{invite.email}</strong> to
          accept, or create an account with that address if you don&rsquo;t have
          one yet.
        </p>
        <div className="space-y-3">
          <Button
            asChild
            className="h-12 w-full rounded-full bg-warm-ink text-warm-cream hover:bg-warm-ink/90"
          >
            <Link
              href={`${ROUTES.REGISTER}?email=${encodeURIComponent(
                invite.email,
              )}&from=${encodeURIComponent(returnTo)}`}
            >
              Create an account
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-12 w-full rounded-full">
            <Link href={`${ROUTES.LOGIN}?from=${encodeURIComponent(returnTo)}`}>
              I already have an account
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {acceptError && (
        <Alert variant="destructive">
          <AlertDescription>{acceptError}</AlertDescription>
        </Alert>
      )}
      {summary}
      <Button
        onClick={handleAccept}
        disabled={acceptInvite.isPending}
        className="h-12 w-full rounded-full bg-warm-ink text-warm-cream hover:bg-warm-ink/90"
      >
        {acceptInvite.isPending ? 'Joining…' : 'Accept invitation'}
      </Button>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-warm-ink/10 bg-warm-surface p-8 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        <div className="mb-6 flex flex-col items-center text-center">
          <Wordmark size={36} />
          <p className="mt-3 text-sm text-warm-ink-mid">Organization invitation</p>
        </div>

        <Suspense
          fallback={
            <div className="space-y-4">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-12 w-full" />
            </div>
          }
        >
          <AcceptInviteContent />
        </Suspense>
      </div>
    </div>
  );
}
