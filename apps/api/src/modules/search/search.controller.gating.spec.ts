import type { JwtPayload } from '@libertasian/types';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { AdminBypassAuditService } from '../../common/services/admin-bypass-audit.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { IndexRebuildService } from './index-rebuild.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import type {
  CitationSearchDto,
  SearchQueryDto,
  SuggestionQueryDto,
} from './dto';

/**
 * The free statutory tier as the SEARCH controller sees it: who is
 * non-entitled, and whether their locked results are removed (mobile) or
 * returned with upgrade meta (web).
 */
describe('SearchController — free statutory tier gating', () => {
  let controller: SearchController;
  let searchService: {
    search: jest.Mock;
    searchByCitation: jest.Mock;
    getSuggestions: jest.Mock;
    countLockedHits: jest.Mock;
    countLockedSuggestions: jest.Mock;
  };
  let entitlementService: { resolveEffectiveEntitlements: jest.Mock };
  let adminBypassAudit: { record: jest.Mock };

  const freeUser: JwtPayload = {
    sub: 'user-1',
    organizationId: 'org-free',
  } as JwtPayload;

  const buildRequest = (
    headers: Record<string, string> = {},
    method = 'POST',
    path = '/search',
  ): Request =>
    ({
      method,
      path,
      route: { path },
      headers,
    }) as unknown as Request;

  const dto = { query: 'civil code', limit: 20 } as SearchQueryDto;

  beforeEach(() => {
    // Constructed directly rather than through Test.createTestingModule: the
    // class-level route guards would otherwise have to be resolvable, and this
    // suite is about the controller's own gate resolution, not its guards.
    searchService = {
      search: jest.fn().mockResolvedValue({ items: [], meta: { total: 0 } }),
      searchByCitation: jest.fn().mockResolvedValue({ total: 0, items: [] }),
      getSuggestions: jest.fn().mockResolvedValue([]),
      countLockedHits: jest.fn().mockReturnValue(0),
      countLockedSuggestions: jest.fn().mockReturnValue(0),
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
  describe('public routes are gated too', () => {
    /** Nest stores @UseGuards under '__guards__' — same trick as the throttle spec. */
    const guardsOn = (handler: unknown): unknown[] =>
      (Reflect.getMetadata('__guards__', handler as object) as unknown[]) ?? [];

    it('carries OptionalJwtAuthGuard on both public GETs', () => {
      // The routes stay open to anonymous callers; the guard exists only to
      // hydrate a present token so the free-tier gate can be resolved. Same
      // pattern as the public GETs on DocumentsController.
      expect(guardsOn(SearchController.prototype.searchByCitation)).toContain(
        OptionalJwtAuthGuard,
      );
      expect(guardsOn(SearchController.prototype.getSuggestions)).toContain(
        OptionalJwtAuthGuard,
      );
      // Not JwtAuthGuard — that would close routes that must stay public.
      expect(guardsOn(SearchController.prototype.searchByCitation)).not.toContain(
        JwtAuthGuard,
      );
    });

    const decisionHit = {
      id: 'doc-decision',
      score: 12,
      source: { document_id: 'doc-decision', document_type: 'decision' },
    };
    const codalHit = {
      id: 'doc-codal',
      score: 10,
      source: { document_id: 'doc-codal', document_type: 'codal' },
    };

    /** The gate argument the controller handed to the service. */
    const citationGate = () =>
      searchService.searchByCitation.mock.calls[0]![1];
    const suggestionGate = () => searchService.getSuggestions.mock.calls[0]![2];

    const citationParams = { citation: 'G.R. No. 123456' } as CitationSearchDto;
    const suggestionQuery = { q: 'people v', limit: 8 } as SuggestionQueryDto;

    beforeEach(() => {
      // Stand in for the narrowing OpenSearch would do, so the response the
      // controller returns is the response a real free caller would get.
      searchService.searchByCitation.mockImplementation(
        (_citation: string, gate: { previewOnly: boolean; excludeLocked: boolean }) => {
          const items =
            gate.previewOnly && gate.excludeLocked
              ? [codalHit]
              : [decisionHit, codalHit];
          return Promise.resolve({ total: items.length, items });
        },
      );
      searchService.getSuggestions.mockResolvedValue([]);
    });

    describe('GET /search/citation/:citation', () => {
      it('returns no decision to an anonymous mobile caller', async () => {
        const response = await controller.searchByCitation(
          citationParams,
          null,
          buildRequest({ 'x-client': 'mobile' }, 'GET', '/search/citation/:citation'),
        );

        // Anonymous is treated as free-tier, matching DocumentsController.
        expect(citationGate()).toEqual({ previewOnly: true, excludeLocked: true });
        expect(response.data).toEqual([codalHit]);
        expect(response.meta.total).toBe(1);
        // Nothing left to advertise once the hits are gone.
        expect(response.meta).not.toHaveProperty('previewMode');
      });

      it('still returns the decision to an authenticated paid caller', async () => {
        entitlementService.resolveEffectiveEntitlements.mockResolvedValue({
          previewOnly: false,
        });

        const response = await controller.searchByCitation(
          citationParams,
          freeUser,
          buildRequest({ 'x-client': 'mobile' }, 'GET', '/search/citation/:citation'),
        );

        expect(citationGate()).toEqual({ previewOnly: false, excludeLocked: true });
        expect(response.data).toEqual([decisionHit, codalHit]);
        expect(response.meta.total).toBe(2);
      });

      it('returns the decision with upgrade meta to a free WEB caller', async () => {
        searchService.countLockedHits.mockReturnValue(1);

        const response = await controller.searchByCitation(
          citationParams,
          freeUser,
          buildRequest({}, 'GET', '/search/citation/:citation'),
        );

        expect(citationGate()).toEqual({ previewOnly: true, excludeLocked: false });
        expect(response.data).toEqual([decisionHit, codalHit]);
        expect(response.meta).toMatchObject({
          previewMode: true,
          lockedCount: 1,
          upgradeRequired: true,
        });
      });
    });

    describe('GET /search/suggestions', () => {
      it('excludes locked rows for an anonymous mobile caller', async () => {
        await controller.getSuggestions(
          suggestionQuery,
          null,
          buildRequest({ 'x-client': 'mobile' }, 'GET', '/search/suggestions'),
        );

        expect(suggestionGate()).toEqual({ previewOnly: true, excludeLocked: true });
      });

      it('leaves an entitled caller unnarrowed', async () => {
        entitlementService.resolveEffectiveEntitlements.mockResolvedValue({
          previewOnly: false,
        });

        await controller.getSuggestions(
          suggestionQuery,
          freeUser,
          buildRequest({ 'x-client': 'mobile' }, 'GET', '/search/suggestions'),
        );

        expect(suggestionGate().previewOnly).toBe(false);
      });

      it('keeps data a bare array and adds meta only for a free web caller', async () => {
        searchService.getSuggestions.mockResolvedValue([
          { id: 's1', documentId: 'doc-decision', title: 'People v. Doe' },
        ]);
        searchService.countLockedSuggestions.mockReturnValue(1);

        const response = await controller.getSuggestions(
          suggestionQuery,
          freeUser,
          buildRequest({}, 'GET', '/search/suggestions'),
        );

        expect(Array.isArray(response.data)).toBe(true);
        expect(response.meta).toMatchObject({
          previewMode: true,
          lockedCount: 1,
          upgradeRequired: true,
        });
      });

      it('omits meta entirely for a mobile caller', async () => {
        const response = await controller.getSuggestions(
          suggestionQuery,
          null,
          buildRequest({ 'x-client': 'mobile' }, 'GET', '/search/suggestions'),
        );

        expect(response).not.toHaveProperty('meta');
      });
    });
  });
});
