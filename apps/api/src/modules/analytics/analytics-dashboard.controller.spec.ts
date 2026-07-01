import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AnalyticsDashboardController } from './analytics-dashboard.controller';
import { AnalyticsDashboardService } from './analytics-dashboard.service';

const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

describe('AnalyticsDashboardController', () => {
  let controller: AnalyticsDashboardController;
  let dashboardService: {
    getOverview: jest.Mock;
    getEngagement: jest.Mock;
    getSearchMetrics: jest.Mock;
    getAiMetrics: jest.Mock;
    getDigestMetrics: jest.Mock;
    getScanMetrics: jest.Mock;
    getStudyMetrics: jest.Mock;
    getWorkspaceMetrics: jest.Mock;
    getRevenueMetrics: jest.Mock;
    getFunnel: jest.Mock;
    getRetention: jest.Mock;
    getIngestionMetrics: jest.Mock;
    getRealtimeStream: jest.Mock;
  };

  beforeEach(async () => {
    dashboardService = {
      getOverview: jest.fn().mockResolvedValue({ dau: 10 }),
      getEngagement: jest.fn().mockResolvedValue({}),
      getSearchMetrics: jest.fn().mockResolvedValue({}),
      getAiMetrics: jest.fn().mockResolvedValue({}),
      getDigestMetrics: jest.fn().mockResolvedValue({}),
      getScanMetrics: jest.fn().mockResolvedValue({}),
      getStudyMetrics: jest.fn().mockResolvedValue({}),
      getWorkspaceMetrics: jest.fn().mockResolvedValue({}),
      getRevenueMetrics: jest.fn().mockResolvedValue({}),
      getFunnel: jest.fn().mockResolvedValue({ steps: [] }),
      getRetention: jest.fn().mockResolvedValue({ cohorts: [] }),
      getIngestionMetrics: jest.fn().mockResolvedValue({}),
      getRealtimeStream: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsDashboardController],
      providers: [{ provide: AnalyticsDashboardService, useValue: dashboardService }],
    })
      .overrideGuard(JwtAuthGuard).useValue(mockGuard)
      .overrideGuard(MfaGuard).useValue(mockGuard)
      .overrideGuard(TenantGuard).useValue(mockGuard)
      .overrideGuard(PermissionsGuard).useValue(mockGuard)
      .compile();

    controller = module.get<AnalyticsDashboardController>(AnalyticsDashboardController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('auth gate', () => {
    it('declares Jwt + Mfa + Tenant + Permissions guards via @UseGuards', () => {
      // Stripping any one of these would let org owners of free personal
      // orgs read platform-wide analytics, so the spec pins the
      // declaration here.
      const guards = (Reflect.getMetadata(GUARDS_METADATA, AnalyticsDashboardController) ?? []) as unknown[];
      expect(guards).toEqual([JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard]);
    });

    it('requires the admin:dashboard platform permission', () => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, AnalyticsDashboardController)).toEqual({
        permissions: ['admin:dashboard'],
        mode: 'any',
      });
    });

    it('carries no org-role gate', () => {
      // The old @Roles('owner', 'admin') gate passed for every
      // self-registered user (each is owner of their personal org).
      expect(Reflect.getMetadata(ROLES_KEY, AnalyticsDashboardController)).toBeUndefined();
    });
  });

  describe('handlers', () => {
    it('getOverview delegates to service', async () => {
      const query = { from: '2026-01-01', to: '2026-01-31' } as never;
      const result = await controller.getOverview(query);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ dau: 10 });
      expect(dashboardService.getOverview).toHaveBeenCalledWith(query);
    });

    it('getFunnel passes funnel name and query', async () => {
      const query = {} as never;
      const result = await controller.getFunnel('signup', query);
      expect(result.success).toBe(true);
      expect(dashboardService.getFunnel).toHaveBeenCalledWith('signup', query);
    });
  });
});
