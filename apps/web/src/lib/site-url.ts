/**
 * Canonical public origin, used by robots.txt and the sitemap.
 *
 * Both are absolute-URL formats — a relative sitemap entry is invalid — so this
 * has to resolve to a real origin at build time. `NEXT_PUBLIC_APP_URL` wins when
 * set; the production domain is the fallback so a missing env var degrades to
 * "correct in prod" rather than to localhost URLs published on the live site.
 */
export const SITE_URL = (
  process.env['NEXT_PUBLIC_APP_URL'] || 'https://libertasian.com'
).replace(/\/+$/, '');
