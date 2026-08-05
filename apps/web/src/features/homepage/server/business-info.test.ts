import { describe, it, expect } from 'vitest';

import { middleware } from '@/middleware';
import { businessInfo, DEFAULT_HOMEPAGE_CONTENT } from './homepage-content';

/**
 * Regression guard for the merchant-KYC audit.
 *
 * Xendit rejected our merchant activation with "some details in your business
 * proof (website/apps) are invalid or do not meet the requirements". Three
 * classes of defect caused it, and each one is cheap to reintroduce by hand:
 *
 *  1. the registered entity name published in three different spellings;
 *  2. contact addresses that reject at SMTP, so the published contact route
 *     was a dead end;
 *  3. public footer/nav links that 307 an anonymous visitor to /login, and
 *     links to app-store listings that do not exist.
 *
 * Every PH gateway (PayMongo, Maya, Dragonpay) runs the same checklist, so
 * these assertions outlive the Xendit application.
 */

/** Mailboxes that reject at SMTP (450 unverified). Must never be published. */
const DEAD_MAILBOXES = [
  'dpo@libertasian.com',
  'legal@libertasian.com',
  'info@libertasian.com',
];

/** Entity spellings that do not match the certificate. */
const WRONG_ENTITY_STRINGS = ['LIBERTASIAN Inc.', 'LIBERTASIAN, Inc.'];

function makeAnonymousRequest(pathname: string) {
  const url = new URL(`https://libertasian.com${pathname}`);
  return {
    nextUrl: url,
    url: url.toString(),
    cookies: { has: () => false, get: () => undefined },
  } as never;
}

function redirectsToLogin(pathname: string): boolean {
  const res = middleware(makeAnonymousRequest(pathname));
  if (res.status !== 307 && res.status !== 308) return false;
  const location = res.headers.get('location');
  return Boolean(location && new URL(location).pathname === '/login');
}

describe('businessInfo — registered identity', () => {
  it('publishes the entity name exactly as it appears on the certificate', () => {
    // All caps, no comma. Do not "fix" this to title case.
    expect(businessInfo.legalName).toBe('LIBERTASIAN INC.');
  });

  it('never carries one of the wrong entity spellings', () => {
    const serialized = JSON.stringify(businessInfo);
    for (const wrong of WRONG_ENTITY_STRINGS) {
      expect(serialized).not.toContain(wrong);
    }
  });

  it('publishes no mailbox that rejects at SMTP', () => {
    const serialized = JSON.stringify(businessInfo);
    for (const dead of DEAD_MAILBOXES) {
      expect(serialized).not.toContain(dead);
    }
  });

  it('carries a full registered address, a phone and a named DPO', () => {
    expect(businessInfo.address.full).toContain('Cagayan de Oro City');
    expect(businessInfo.address.full).toContain('Philippines');
    expect(businessInfo.dpo.name).not.toHaveLength(0);
    expect(businessInfo.dpo.email).toContain('@');
    expect(businessInfo.foundedYear).toBe(2026);
  });

  it('keeps the tel:-safe phone unspaced and the display phone grouped', () => {
    // The two must never be swapped: spaces in a tel: href are unreliable on
    // some dialers, and the unspaced form is the one humans misread.
    expect(businessInfo.phone).toMatch(/^\+63\d+$/);
    expect(businessInfo.phoneDisplay).toBe('+63 956 365 9471');
    expect(businessInfo.phoneDisplay.replace(/\s/g, '')).toBe(businessInfo.phone);
  });
});

describe('footer links — KYC reachability', () => {
  const { footer } = DEFAULT_HOMEPAGE_CONTENT;
  const allLinks = [
    ...footer.productLinks,
    ...footer.legalLinks,
    ...(footer.companyLinks ?? []),
  ];

  it('routes every internal footer link to a page an anonymous visitor can read', () => {
    const walled = allLinks
      .map((l) => l.href)
      // Hash links resolve to '/', which is public; external links are not ours.
      .filter((href) => href.startsWith('/') && !href.startsWith('/#'))
      .filter((href) => redirectsToLogin(href));

    expect(walled).toEqual([]);
  });

  it('does not link the dashboard-only /bar-exams route', () => {
    expect(allLinks.map((l) => l.href)).not.toContain('/bar-exams');
  });

  // study-picker.tsx renders this one href five times (section link + 4 cards),
  // so a regression here puts five login-wall links on the landing page.
  it('does not send the homepage study picker into the auth wall', () => {
    const href = DEFAULT_HOMEPAGE_CONTENT.studyPicker?.sectionLinkHref;
    expect(href).toBeDefined();
    expect(redirectsToLogin(href as string)).toBe(false);
  });

  it('does not advertise app-store listings that do not exist', () => {
    const labels = footer.productLinks.map((l) => l.label);
    expect(labels).not.toContain('iOS App');
    expect(labels).not.toContain('Android App');
  });

  it('points "About" at the About page, not the blog', () => {
    const about = (footer.companyLinks ?? []).find((l) => l.label === 'About');
    expect(about?.href).toBe('/about');
  });

  it('exposes Contact and Refund Policy in the legal column', () => {
    const hrefs = footer.legalLinks.map((l) => l.href);
    expect(hrefs).toContain('/contact');
    expect(hrefs).toContain('/refund-policy');
  });

  it('shows the contact email from the single source of truth', () => {
    expect(footer.contactEmail).toBe(businessInfo.email);
  });
});

describe('homepage stats — substantiation', () => {
  const items = DEFAULT_HOMEPAGE_CONTENT.stats?.items ?? [];
  const labels = items.map((s) => s.label);

  it('no longer claims a law-school count', () => {
    // There is no schools/universities table, and prod holds 25 users across
    // 21 orgs and 3 email domains. Nothing substantiated "100+ Law schools".
    expect(labels).not.toContain('Law schools');
  });

  it('no longer claims an app-store rating', () => {
    // A third-party rating for a listing that does not exist: App Store search
    // and a bundleId lookup for com.libertasian.app both return 0 results, and
    // Play returns 404.
    expect(labels).not.toContain('App store');
    expect(items.map((s) => s.value)).not.toContain('4.9★');
  });

  it('states the replacement figures at or below the measured counts', () => {
    // Measured on prod 2026-08-05: 97 bar sittings, 68,849 sections indexed.
    // A claim may under-state what we can show; it may never over-state it.
    expect(items).toContainEqual({ value: '97', label: 'Bar sittings, 1953–2024' });
    expect(items).toContainEqual({ value: '68,000+', label: 'Sections indexed' });
  });

  it('keeps the strip at four tiles', () => {
    expect(items).toHaveLength(4);
  });
});
