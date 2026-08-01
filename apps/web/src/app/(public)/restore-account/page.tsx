import { RestoreAccountClient } from './restore-account-client';

export const metadata = {
  title: 'Restore Your Account',
  description:
    'Restore a LIBERTASIAN account that was scheduled for deletion, using the single-use link emailed to you.',
};

/**
 * Landing page for the restore link emailed when an account is deleted.
 *
 * PUBLIC by necessity: a `pending_deletion` account cannot sign in, so there
 * is no session to arrive with. `/restore-account` is listed in the
 * middleware's PUBLIC_PATHS (and PUBLIC_PREFIXES) — an unlisted route 307s to
 * /login, which is the exact bug that hit /account-deletion in PR #305.
 *
 * The client reads `?token=` from `window.location` rather than
 * `useSearchParams`, so this page needs no Suspense boundary and still
 * prerenders statically.
 */
export default function RestoreAccountPage() {
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <RestoreAccountClient />
    </div>
  );
}
