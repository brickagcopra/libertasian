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
    expect(businessInfo.phone).toMatch(/^\+63\d+$/);
    expect(businessInfo.dpo.name).not.toHaveLength(0);
    expect(businessInfo.dpo.email).toContain('@');
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
  it('no longer claims a law-school count', () => {
    // There is no schools/universities table, and prod holds 25 users across
    // 21 orgs and 3 email domains. Nothing substantiated "100+ Law schools".
    const labels = (DEFAULT_HOMEPAGE_CONTENT.stats?.items ?? []).map((s) => s.label);
    expect(labels).not.toContain('Law schools');
  });
});
