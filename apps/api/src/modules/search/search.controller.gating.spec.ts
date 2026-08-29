import type { JwtPayload } from '@libertasian/types';
import type { Request } from 'express';

import { AdminBypassAuditService } from '../../common/services/admin-bypass-audit.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { IndexRebuildService } from './index-rebuild.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import type { SearchQueryDto } from './dto';

/**
 * The free statutory tier as the SEARCH controller sees it: who is
 * non-entitled, and whether their locked results are removed (mobile) or
 * returned with upgrade meta (web).
 */
describe('SearchController — free statutory tier gating', () => {
  let controller: SearchController;
  let searchService: { search: jest.Mock };
  let entitlementService: { resolveEffectiveEntitlements: jest.Mock };
  let adminBypassAudit: { record: jest.Mock };

  const freeUser: JwtPayload = {
    sub: 'user-1',
    organizationId: 'org-free',
  } as JwtPayload;

  const buildRequest = (headers: Record<string, string> = {}): Request =>
    ({
      method: 'POST',
      path: '/search',
      route: { path: '/search' },
      headers,
    }) as unknown as Request;

  const dto = { query: 'civil code', limit: 20 } as SearchQueryDto;

  beforeEach(() => {
    // Constructed directly rather than through Test.createTestingModule: the
    // class-level route guards would otherwise have to be resolvable, and this
    // suite is about the controller's own gate resolution, not its guards.
    searchService = {
      search: jest.fn().mockResolvedValue({ items: [], meta: { total: 0 } }),
    };
    entitlementService = {
      resolveEffectiveEntitlements: jest
        .fn()
        .mockResolvedValue({ previewOnly: true }),
    };
    adminBypassAudit = { record: jest.fn() };

    controller = new SearchController(
      searchService as unknown as SearchService,
      { log: jest.fn() } as unknown as AuditService,
      {
        checkAndIncrement: jest.fn().mockResolvedValue({
          allowed: true,
          used: 1,
          limit: 50,
          remaining: 49,
        }),
      } as unknown as UsageQuotaService,
      {} as IndexRebuildService,
      entitlementService as unknown as EntitlementService,
      adminBypassAudit as unknown as AdminBypassAuditService,
    );
  });

  /** The third argument to `SearchService.search` — the free-tier gate. */
  const gateFromLastCall = () => searchService.search.mock.calls[0]![2];

  it('passes previewOnly=true for a free org', async () => {
    await controller.search(dto, freeUser, buildRequest());

    expect(gateFromLastCall()).toEqual({ previewOnly: true, excludeLocked: false });
  });

  it('passes previewOnly=false for an entitled org', async () => {
    entitlementService.resolveEffectiveEntitlements.mockResolvedValue({
      previewOnly: false,
    });

    await controller.search(dto, freeUser, buildRequest());

    expect(gateFromLastCall()).toEqual({ previewOnly: false, excludeLocked: false });
  });

  it('excludes locked results for X-Client: mobile', async () => {
    await controller.search(dto, freeUser, buildRequest({ 'x-client': 'mobile' }));

    expect(gateFromLastCall()).toEqual({ previewOnly: true, excludeLocked: true });
  });

  it('matches AuthController.isMobileClient — the header is case-insensitive', async () => {
    await controller.search(dto, freeUser, buildRequest({ 'x-client': 'MoBiLe' }));

    expect(gateFromLastCall().excludeLocked).toBe(true);
  });

  it('treats any other X-Client value as web', async () => {
    await controller.search(dto, freeUser, buildRequest({ 'x-client': 'web' }));

    expect(gateFromLastCall().excludeLocked).toBe(false);
  });

  it('bypasses the gate for a platform admin and audits the bypass', async () => {
    const admin = { ...freeUser, isPlatformAdmin: true } as JwtPayload;

    await controller.search(dto, admin, buildRequest());

    expect(gateFromLastCall().previewOnly).toBe(false);
    expect(adminBypassAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', organizationId: 'org-free' }),
    );
    // An admin bypass must not consult the org's entitlements at all
    expect(entitlementService.resolveEffectiveEntitlements).not.toHaveBeenCalled();
  });

  it('resolves entitlements from the JWT org, never from the request body', async () => {
    await controller.search(
      { ...dto, organizationId: 'org-other' } as unknown as SearchQueryDto,
      freeUser,
      buildRequest(),
    );

    // Cross-tenant guard: a body-supplied org id is an org-enumeration
    // primitive. Both the entitlement lookup and the derivative principal must
    // come from the verified JWT claims.
    expect(entitlementService.resolveEffectiveEntitlements).toHaveBeenCalledWith(
      'org-free',
    );
    expect(searchService.search.mock.calls[0]![1]).toEqual({
      organizationId: 'org-free',
    });
  });
});
