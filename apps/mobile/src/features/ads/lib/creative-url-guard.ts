import { Linking } from 'react-native';

/**
 * Ad creatives are server-authored: an admin can point `ctaUrl` anywhere,
 * after the binary has shipped and been reviewed. A creative pointing at
 * /pricing or a Xendit checkout would put a live, unreviewable build in
 * violation of Apple Guideline 3.1.1 and Google Play's Payments policy — with
 * no way to fix it except a new store submission.
 *
 * Prod has zero rows in `ad_creatives` today, so nothing violates right now.
 * This guard exists so that stays true no matter what is inserted later.
 *
 * It is intentionally a DENY list of purchase-shaped paths rather than an
 * allow list of hosts: ads are expected to point at arbitrary third-party
 * sites (that is what an ad is), and only the purchase shape is the problem.
 */

/**
 * Path segments that indicate a purchase, pricing, or billing surface.
 * Matched as whole path segments so `/enterprise-plans-explained` is caught
 * while `/blog/how-we-priced-the-corpus` is not.
 */
const PURCHASE_SEGMENTS = [
  'pricing',
  'price',
  'prices',
  'checkout',
  'billing',
  'subscribe',
  'subscription',
  'subscriptions',
  'plans',
  'plan',
  'upgrade',
  'buy',
  'purchase',
  'payment',
  'payments',
  'pay',
  'cart',
  'order',
  'store',
  'donate',
];

/** Hosts that exist only to take money. Any path on them is a purchase. */
const PURCHASE_HOSTS = [
  'checkout.xendit.co',
  'xendit.co',
  'paypal.com',
  'stripe.com',
  'checkout.stripe.com',
  'gcash.com',
  'paymaya.com',
  'maya.ph',
];

function hostMatches(host: string, candidate: string): boolean {
  return host === candidate || host.endsWith(`.${candidate}`);
}

/**
 * True when the URL leads to a purchase, pricing, or billing surface — or is
 * malformed badly enough that we cannot tell.
 *
 * Fails CLOSED. A URL we cannot parse is refused, because the cost of
 * wrongly blocking one ad click is a dead link and the cost of wrongly
 * allowing one is a store rejection.
 */
export function isPurchaseUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false; // nothing to open; not a violation

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return true; // unparseable → refuse
  }

  // Only http(s) creatives are ever opened elsewhere in this feature, but a
  // custom scheme could deep-link straight into a purchase flow.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;

  const host = url.hostname.toLowerCase();
  if (PURCHASE_HOSTS.some((h) => hostMatches(host, h))) return true;

  const segments = url.pathname
    .toLowerCase()
    .split('/')
    .filter(Boolean)
    // Strip a trailing extension so /pricing.html is still /pricing.
    .map((s) => s.replace(/\.(html?|php|aspx?)$/, ''));

  if (segments.some((s) => PURCHASE_SEGMENTS.includes(s))) return true;

  // Query strings are a second door: /go?to=/pricing or ?plan=pro.
  for (const [key, value] of url.searchParams.entries()) {
    const haystack = `${key} ${value}`.toLowerCase();
    if (PURCHASE_SEGMENTS.some((s) => haystack.includes(s))) return true;
  }

  return false;
}

/**
 * True when a creative may be rendered at all. A creative whose CTA leads to a
 * purchase is suppressed entirely rather than rendered with a dead button —
 * the pitch itself ("Go Pro for ₱999") is the violation, not just the tap.
 */
export function isCreativeAllowed(creative: {
  ctaUrl?: string | null;
}): boolean {
  return !isPurchaseUrl(creative.ctaUrl);
}

/**
 * Open a creative's CTA, refusing anything purchase-shaped.
 *
 * Returns whether the URL was opened, so callers can decide what to do
 * (in practice: nothing — the creative should already have been suppressed by
 * {@link isCreativeAllowed}; this is the second lock on the same door).
 */
export function openCreativeUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;
  if (!rawUrl.startsWith('http')) return false;
  if (isPurchaseUrl(rawUrl)) return false;

  void Linking.openURL(rawUrl);
  return true;
}
