import { describe, it, expect } from 'vitest';

import {
  ADMIN_NAV_ITEMS,
  canAccessAdminArea,
  visibleAdminNavItems,
} from './admin-nav';

/**
 * The admin nav is the single source of truth for who may enter the admin
 * area: the sidebar renders `visibleAdminNavItems` and the /admin route guard
 * admits on `canAccessAdminArea`, both from this list. Drift between the two
 * shows up as either a nav entry that bounces you to /search or an admin area
 * with an empty sidebar.
 */
describe('admin nav permissions', () => {
  it('every entry declares at least one platform permission', () => {
    // An entry with no codes would be visible to everyone the moment they
    // hold any platform permission at all.
    for (const item of ADMIN_NAV_ITEMS) {
      expect(item.permissions.length).toBeGreaterThan(0);
    }
  });

  it('every declared code is a platform code (admin:* or a resource code)', () => {
    for (const item of ADMIN_NAV_ITEMS) {
      for (const code of item.permissions) {
        expect(code).toMatch(/^[a-z-]+:[a-z-]+$/);
      }
    }
  });

  it('shows nothing to someone with no platform permissions', () => {
    expect(visibleAdminNavItems([])).toEqual([]);
    expect(visibleAdminNavItems(undefined)).toEqual([]);
    expect(canAccessAdminArea([])).toBe(false);
  });

  it('shows nothing to a personal-workspace owner, whatever tenant rights they hold', () => {
    // The caller's tenant permissions are never passed here; this asserts the
    // shape of the contract — only platform codes reach this function.
    expect(canAccessAdminArea(['members:read', 'roles:create'])).toBe(false);
  });

  it('admits a reviewer via digests:review, with NO admin:* code', () => {
    // The constraint that shapes this whole design: granting reviewer an
    // admin:* code to let them in would trip subscription.guard.ts:61, which
    // treats isPlatformAdmin === true as a complete subscription bypass.
    const reviewerCodes = ['digests:read', 'digests:review', 'digests:approve'];

    expect(reviewerCodes.some((c) => c.startsWith('admin:'))).toBe(false);
    expect(canAccessAdminArea(reviewerCodes)).toBe(true);

    const visible = visibleAdminNavItems(reviewerCodes);
    expect(visible.map((i) => i.href)).toEqual(['/admin/review']);
  });

  it('review queue accepts either code, exactly as the server guard does', () => {
    const review = ADMIN_NAV_ITEMS.find((i) => i.href === '/admin/review');
    expect(review?.permissions.sort()).toEqual([
      'admin:review-queue',
      'digests:review',
    ]);
  });

  it('gives an editor the editorial surfaces and none of the business ones', () => {
    const editorCodes = [
      'admin:dashboard',
      'admin:corpus-health',
      'admin:ingestion',
      'admin:review-queue',
      'admin:coverage-gaps',
      'admin:duplicates',
      'admin:knowledge-graph',
      'digests:review',
    ];

    const hrefs = visibleAdminNavItems(editorCodes).map((i) => i.href);

    expect(hrefs).toContain('/admin/review');
    expect(hrefs).toContain('/admin/ingestion');
    expect(hrefs).toContain('/admin/duplicates');
    expect(hrefs).not.toContain('/admin/users');
    expect(hrefs).not.toContain('/admin/subscriptions');
    expect(hrefs).not.toContain('/admin/plans');
    expect(hrefs).not.toContain('/admin/coupons');
  });

  it('gives a full admin every entry', () => {
    const allCodes = [...new Set(ADMIN_NAV_ITEMS.flatMap((i) => i.permissions))];

    expect(visibleAdminNavItems(allCodes)).toHaveLength(ADMIN_NAV_ITEMS.length);
  });

  it('ignores a platform code that matches no entry', () => {
    // Holding an unrelated platform permission must not open the admin area.
    expect(canAccessAdminArea(['uploads:read'])).toBe(false);
  });

  it('canAccessAdminArea agrees with visibleAdminNavItems', () => {
    const cases = [
      [],
      ['admin:dashboard'],
      ['digests:review'],
      ['uploads:read'],
      ['admin:users', 'admin:billing'],
    ];

    for (const codes of cases) {
      expect(canAccessAdminArea(codes)).toBe(
        visibleAdminNavItems(codes).length > 0,
      );
    }
  });
});
