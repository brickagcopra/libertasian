/**
 * Which parts of /admin a platform REVIEWER may reach.
 *
 * `/admin/*` is gated on `isPlatformAdmin`, which is "holds any admin:*
 * permission". A platform `reviewer` holds none, so before this the API fix
 * was invisible: someone granted `reviewer` in Admin → Staff could be assigned
 * a digest and then be bounced to /search when they tried to open the queue.
 *
 * The permission is the authorization decision; the route list only decides
 * what a reviewer is shown and allowed to navigate to. Deliberately narrow —
 * the rest of the admin shell is still admin-only, and annotating every admin
 * route with its permission is a separate cleanup.
 *
 * Shared by the /admin layout gate and the sidebar so the two cannot drift:
 * a route a reviewer may open but sees no link to is as broken as a link that
 * 403s.
 */

/** The platform permission that admits someone to the review surfaces. */
export const REVIEW_PERMISSION = 'digests:review';

/**
 * Route prefixes a reviewer may reach. `/admin/digests` is included because
 * scoring a digest means opening it — the review form lives on the detail page.
 */
export const REVIEWER_ROUTE_PREFIXES = ['/admin/review', '/admin/digests'] as const;

/** Where a reviewer lands when they hit an admin route that is not theirs. */
export const REVIEWER_HOME = '/admin/review';

/** Nav hrefs a reviewer is shown. Anything else would 403 at the API. */
export const REVIEWER_NAV_HREFS: ReadonlySet<string> = new Set(['/admin/review']);

/** Is this pathname one of the review surfaces? */
export function isReviewerRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return REVIEWER_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
