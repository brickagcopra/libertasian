import { Linking, Platform } from 'react-native';

/**
 * Opens the STORE'S OWN account page where a person manages or cancels what
 * they bought through it.
 *
 * Lives outside `features/purchase/` on purpose. That tree is held by
 * `no-external-payment.test.ts` to "no URL, no Linking": the rule exists so the
 * purchase screen can never point at a way to pay outside the store (Guideline
 * 3.1.1). Cancelling is the opposite direction, and both stores want it
 * reachable from the app — but the exception is kept to this one module, and
 * this module will only ever open a page on the store's own host.
 *
 * The URL normally comes from RevenueCat's `customerInfo.managementURL`, which
 * points at whichever store sold the active subscription. Anything that is not
 * an https URL on a store host is refused, whatever supplied it.
 */

/** The only hosts this module will open. */
export const STORE_ACCOUNT_HOSTS: ReadonlySet<string> = new Set([
  'apps.apple.com',
  'play.google.com',
]);

/** Each store's generic page, for when no per-purchase URL is known. */
const STORE_ACCOUNT_FALLBACK: Partial<Record<typeof Platform.OS, string>> = {
  ios: 'https://apps.apple.com/account/subscriptions',
  android: 'https://play.google.com/store/account/subscriptions',
};

export function isStoreAccountUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  // Not `new URL()`: React Native's built-in URL has shipped without `hostname`
  // (it throws), which would refuse every page on a device while passing under
  // jest's Node URL. Userinfo (`user@host`) and ports are refused outright.
  const match = /^https:\/\/([a-z0-9.-]+)(?:[/?#]|$)/i.exec(url);
  return match !== null && STORE_ACCOUNT_HOSTS.has(match[1]!.toLowerCase());
}

/**
 * Open the store's management page. `preferredUrl` is used only if it is a
 * store page; otherwise the current platform's generic page is opened.
 * Resolves false when there was nothing safe to open or the OS refused.
 */
export async function openStoreAccountPage(
  preferredUrl?: string | null,
): Promise<boolean> {
  const fallback = STORE_ACCOUNT_FALLBACK[Platform.OS];
  const target = isStoreAccountUrl(preferredUrl) ? preferredUrl : fallback;
  if (!target) return false;
  try {
    await Linking.openURL(target);
    return true;
  } catch {
    return false;
  }
}
