import { Test, TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import { SubscriptionAdminController } from './subscription-admin.controller';
import { SubscriptionOperationsService } from './subscription-operations.service';
import { SubscriptionAdminService } from './subscription-admin.service';
import { EntitlementService } from './entitlement.service';
import { SubscriptionState } from './subscription-state-machine';

describe('SubscriptionAdminController', () => {
  let controller: SubscriptionAdminController;
  let operationsService: jest.Mocked<SubscriptionOperationsService>;
  let adminService: jest.Mocked<SubscriptionAdminService>;
  let entitlementService: jest.Mocked<EntitlementService>;
  let auditService: jest.Mocked<AuditService>;

  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

  const mockAdmin = {
    sub: 'admin-1',
    organizationId: 'org-editorial',
    email: 'admin@example.com',
    role: 'admin',
  } as any;

  const mockReq = { ip: '127.0.0.1' } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionAdminController],
      providers: [
        {
          provide: SubscriptionOperationsService,
          useValue: {
            grantComplimentary: jest.fn(),
            revokeComplimentary: jest.fn(),
            expireTrial: jest.fn(),
          },
        },
        {
          provide: SubscriptionAdminService,
          useValue: {
            listSubscriptions: jest.fn(),
            getSubscriptionDetail: jest.fn(),
            getSubscriptionHistory: jest.fn(),
            getSubscriptionMigrations: jest.fn(),
            forceCancelSubscription: jest.fn(),
            extendTrial: jest.fn(),
            changeBillingPeriod: jest.fn(),
          },
        },
        {
          provide: EntitlementService,
          useValue: {
            grantBonus: jest.fn(),
            revokeBonus: jest.fn(),
            getOverrideHistory: jest.fn(),
            getEffectiveEntitlementReport: jest.fn(),
            setSubscriptionEntitlements: jest.fn(),
            clearSubscriptionEntitlement: jest.fn(),
            pruneSubscriptionEntitlementKey: jest.fn(),
            countStoredEntitlementKeys: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(mockGuard)
      .overrideGuard(MfaGuard).useValue(mockGuard)
      .overrideGuard(TenantGuard).useValue(mockGuard)
      .overrideGuard(PermissionsGuard).useValue(mockGuard)
      .compile();

    controller = module.get<SubscriptionAdminController>(SubscriptionAdminController);
    operationsService = module.get(SubscriptionOperationsService);
    adminService = module.get(SubscriptionAdminService);
    entitlementService = module.get(EntitlementService);
    auditService = module.get(AuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---- List & Detail Endpoints ----

  describe('listSubscriptions', () => {
    it('should delegate to adminService.listSubscriptions', async () => {
      const mockResult = {
        data: [{ id: 'sub-1' }],
        nextCursor: 'sub-1',
        hasNext: false,
      };
      adminService.listSubscriptions.mockResolvedValue(mockResult as any);

      const result = await controller.listSubscriptions({
        status: 'active',
        planCode: 'pro',
        limit: 10,
      } as any);

      expect(adminService.listSubscriptions).toHaveBeenCalledWith({
        status: 'active',
        planCode: 'pro',
        organizationId: undefined,
        search: undefined,
        limit: 10,
        cursor: undefined,
      });
      expect(result).toEqual({
        success: true,
        data: mockResult.data,
        nextCursor: 'sub-1',
        hasNext: false,
      });
    });
  });

  describe('getSubscriptionDetail', () => {
    it('should delegate to adminService.getSubscriptionDetail', async () => {
      const mockDetail = {
        id: 'sub-1',
        status: 'active',
        validActions: ['CANCEL_IMMEDIATELY'],
      };
      adminService.getSubscriptionDetail.mockResolvedValue(mockDetail as any);

      const result = await controller.getSubscriptionDetail('sub-1');

      expect(adminService.getSubscriptionDetail).toHaveBeenCalledWith('sub-1');
      expect(result).toEqual({ success: true, data: mockDetail });
    });
  });

  describe('getSubscriptionHistory', () => {
    it('should delegate to adminService.getSubscriptionHistory', async () => {
      const mockResult = {
        data: [{ id: 'hist-1' }],
        nextCursor: null,
        hasNext: false,
      };
      adminService.getSubscriptionHistory.mockResolvedValue(mockResult as any);

      const result = await controller.getSubscriptionHistory('sub-1', {
        action: 'ACTIVATE',
        limit: 10,
      } as any);

      expect(adminService.getSubscriptionHistory).toHaveBeenCalledWith('sub-1', {
        action: 'ACTIVATE',
        actorType: undefined,
        limit: 10,
        cursor: undefined,
      });
      expect(result).toEqual({
        success: true,
        data: mockResult.data,
        nextCursor: null,
        hasNext: false,
      });
    });
  });

  describe('getSubscriptionMigrations', () => {
    it('should delegate to adminService.getSubscriptionMigrations', async () => {
      const mockResult = {
        data: [{ id: 'mig-1' }],
        nextCursor: null,
        hasNext: false,
      };
      adminService.getSubscriptionMigrations.mockResolvedValue(mockResult as any);

      const result = await controller.getSubscriptionMigrations('sub-1', {
        limit: 5,
      } as any);

      expect(adminService.getSubscriptionMigrations).toHaveBeenCalledWith('sub-1', {
        limit: 5,
        cursor: undefined,
      });
      expect(result).toEqual({
        success: true,
        data: mockResult.data,
        nextCursor: null,
        hasNext: false,
      });
    });
  });

  // ---- Admin Action Endpoints ----

  describe('forceCancelSubscription', () => {
    it('should delegate to adminService and log audit', async () => {
      const mockResult = {
        success: true,
        subscriptionId: 'sub-1',
        fromState: SubscriptionState.ACTIVE,
        toState: SubscriptionState.CANCELLED,
      };
      adminService.forceCancelSubscription.mockResolvedValue(mockResult as any);

      const result = await controller.forceCancelSubscription(
        'sub-1',
        { reason: 'TOS violation' } as any,
        mockAdmin,
        mockReq,
      );

      expect(adminService.forceCancelSubscription).toHaveBeenCalledWith(
        'sub-1',
        'admin-1',
        'TOS violation',
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.admin_force_cancel',
          entityId: 'sub-1',
        }),
      );
      expect(result).toEqual({ success: true, data: mockResult });
    });
  });

  describe('extendTrial', () => {
    it('should delegate to adminService and log audit', async () => {
      const mockResult = {
        subscriptionId: 'sub-1',
        extensionDays: 14,
        newTrialEndsAt: new Date('2026-02-15'),
      };
      adminService.extendTrial.mockResolvedValue(mockResult as any);

      const result = await controller.extendTrial(
        'sub-1',
        { extensionDays: 14 } as any,
        mockAdmin,
        mockReq,
      );

      expect(adminService.extendTrial).toHaveBeenCalledWith(
        'sub-1',
        14,
        'admin-1',
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.admin_extend_trial',
          entityId: 'sub-1',
          metadata: expect.objectContaining({ extensionDays: 14 }),
        }),
      );
      expect(result).toEqual({ success: true, data: mockResult });
    });
  });

  describe('changeBillingPeriod', () => {
    it('should delegate to adminService and log audit', async () => {
      const mockResult = {
        subscriptionId: 'sub-1',
        fromBillingPeriod: 'monthly',
        toBillingPeriod: 'annual',
      };
      adminService.changeBillingPeriod.mockResolvedValue(mockResult as any);

      const result = await controller.changeBillingPeriod(
        'sub-1',
        { billingPeriod: 'annual' } as any,
        mockAdmin,
        mockReq,
      );

      expect(adminService.changeBillingPeriod).toHaveBeenCalledWith(
        'sub-1',
        'annual',
        'admin-1',
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.admin_change_billing_period',
          entityId: 'sub-1',
          metadata: expect.objectContaining({ billingPeriod: 'annual' }),
        }),
      );
      expect(result).toEqual({ success: true, data: mockResult });
    });
  });

  // ---- Existing complimentary/trial tests (updated with audit logging) ----

  describe('grantComplimentary', () => {
    it('should delegate to operations service and log audit', async () => {
      const mockResult = {
        subscriptionId: 'sub-1',
        complimentaryAccessId: 'comp-1',
        planCode: 'pro',
        organizationId: 'org-target',
        status: SubscriptionState.COMPLIMENTARY,
      };
      (operationsService.grantComplimentary as jest.Mock).mockResolvedValue(mockResult);

      const result = await controller.grantComplimentary(
        {
          organizationId: 'org-target',
          planCode: 'pro',
          reason: 'Partnership deal',
          endsAt: '2026-12-31',
        } as any,
        mockAdmin,
        mockReq,
      );

      expect(operationsService.grantComplimentary).toHaveBeenCalledWith(
        'org-target',
        'pro',
        'Partnership deal',
        'admin-1',
        '2026-12-31',
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.admin_grant_complimentary',
          entityId: 'sub-1',
        }),
      );
      expect(result).toEqual({ success: true, data: mockResult });
    });
  });

  describe('revokeComplimentary', () => {
    it('should delegate with subscription id and log audit', async () => {
      const mockResult = {
        subscriptionId: 'sub-1',
        complimentaryAccessId: 'comp-1',
        status: SubscriptionState.CANCELLED,
      };
      (operationsService.revokeComplimentary as jest.Mock).mockResolvedValue(mockResult);

      const result = await controller.revokeComplimentary(
        'sub-1',
        { reason: 'Partnership ended' } as any,
        mockAdmin,
        mockReq,
      );

      expect(operationsService.revokeComplimentary).toHaveBeenCalledWith(
        'sub-1',
        'admin-1',
        'Partnership ended',
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.admin_revoke_complimentary',
          entityId: 'sub-1',
        }),
      );
      expect(result).toEqual({ success: true, data: mockResult });
    });
  });

  describe('expireTrial', () => {
    it('should delegate with admin actor type and log audit', async () => {
      const mockResult = {
        subscriptionId: 'sub-1',
        status: SubscriptionState.TRIAL_EXPIRED,
      };
      (operationsService.expireTrial as jest.Mock).mockResolvedValue(mockResult);

      const result = await controller.expireTrial('sub-1', mockAdmin, mockReq);

      expect(operationsService.expireTrial).toHaveBeenCalledWith(
        'sub-1',
        'admin-1',
        'admin',
        'Admin force-expired trial',
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.admin_expire_trial',
          entityId: 'sub-1',
        }),
      );
      expect(result).toEqual({ success: true, data: mockResult });
    });
  });

  // ---- Entitlement Override Endpoints ----

  describe('grantOverride', () => {
    it('should delegate to entitlementService.grantBonus with correct params', async () => {
      const mockOverride = { id: 'ov-1', entitlementKey: 'aiAnswers' };
      entitlementService.grantBonus.mockResolvedValue(mockOverride as any);

      const dto = {
        organizationId: 'org-target',
        entitlementKey: 'aiAnswers',
        overrideType: 'bonus_credit' as const,
        numericValue: 50,
        reason: 'Customer appreciation',
        sourceType: 'admin' as const,
        startsAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-06-01T00:00:00.000Z',
      };

      const result = await controller.grantOverride(dto as any, mockAdmin);

      expect(entitlementService.grantBonus).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-target',
          entitlementKey: 'aiAnswers',
          overrideType: 'bonus_credit',
          numericValue: 50,
          createdByUserId: 'admin-1',
        }),
      );
      expect(result).toEqual({ success: true, data: mockOverride });
    });

    it('should use admin user sub as createdByUserId', async () => {
      entitlementService.grantBonus.mockResolvedValue({ id: 'ov-1' } as any);

      await controller.grantOverride(
        {
          organizationId: 'org-1',
          entitlementKey: 'aiAnswers',
          overrideType: 'bonus_credit',
          reason: 'Test',
          sourceType: 'admin',
          startsAt: '2026-01-01T00:00:00.000Z',
        } as any,
        mockAdmin,
      );

      expect(entitlementService.grantBonus).toHaveBeenCalledWith(
        expect.objectContaining({ createdByUserId: 'admin-1' }),
      );
    });
  });

  describe('revokeOverride', () => {
    it('should delegate to entitlementService.revokeBonus', async () => {
      const mockOverride = { id: 'ov-1', isActive: false };
      entitlementService.revokeBonus.mockResolvedValue(mockOverride as any);

      const result = await controller.revokeOverride(
        'ov-1',
        { reason: 'No longer needed' } as any,
        mockAdmin,
      );

      expect(entitlementService.revokeBonus).toHaveBeenCalledWith(
        'ov-1',
        'admin-1',
        'No longer needed',
      );
      expect(result).toEqual({ success: true, data: mockOverride });
    });
  });

  describe('listOverrides', () => {
    it('should delegate to entitlementService.getOverrideHistory', async () => {
      const mockResult = {
        data: [{ id: 'ov-1' }, { id: 'ov-2' }],
        nextCursor: 'ov-2',
        hasNext: true,
      };
      entitlementService.getOverrideHistory.mockResolvedValue(mockResult as any);

      const result = await controller.listOverrides({
        organizationId: 'org-1',
        limit: 10,
        cursor: undefined,
      } as any);

      expect(entitlementService.getOverrideHistory).toHaveBeenCalledWith(
        'org-1',
        { limit: 10, cursor: undefined },
      );
      expect(result).toEqual({
        success: true,
        data: mockResult.data,
        nextCursor: 'ov-2',
        hasNext: true,
      });
    });

    it('should pass cursor for pagination', async () => {
      entitlementService.getOverrideHistory.mockResolvedValue({
        data: [],
        nextCursor: null,
        hasNext: false,
      } as any);

      await controller.listOverrides({
        organizationId: 'org-1',
        limit: 20,
        cursor: 'ov-5',
      } as any);

      expect(entitlementService.getOverrideHistory).toHaveBeenCalledWith(
        'org-1',
        { limit: 20, cursor: 'ov-5' },
      );
    });
  });

  // ---- Effective entitlements ----

  describe('getEffectiveEntitlements', () => {
    const SUB = '11111111-1111-4111-8111-111111111111';

    it('maps platform=web onto the null platform the resolver uses', async () => {
      entitlementService.getEffectiveEntitlementReport.mockResolvedValue({
        keys: [],
      } as any);

      await controller.getEffectiveEntitlements(SUB, { platform: 'web' } as any);

      expect(
        entitlementService.getEffectiveEntitlementReport,
      ).toHaveBeenCalledWith(SUB, null);
    });

    it('defaults to the null platform when none is given', async () => {
      entitlementService.getEffectiveEntitlementReport.mockResolvedValue({
        keys: [],
      } as any);

      await controller.getEffectiveEntitlements(SUB, {} as any);

      expect(
        entitlementService.getEffectiveEntitlementReport,
      ).toHaveBeenCalledWith(SUB, null);
    });

    it.each(['ios', 'android'])('passes %s through', async (platform) => {
      entitlementService.getEffectiveEntitlementReport.mockResolvedValue({
        keys: [],
      } as any);

      await controller.getEffectiveEntitlements(SUB, { platform } as any);

      expect(
        entitlementService.getEffectiveEntitlementReport,
      ).toHaveBeenCalledWith(SUB, platform);
    });

    it('wraps the report in the standard success envelope', async () => {
      const report = { subscriptionId: SUB, keys: [] };
      entitlementService.getEffectiveEntitlementReport.mockResolvedValue(
        report as any,
      );

      const result = await controller.getEffectiveEntitlements(SUB, {} as any);

      expect(result).toEqual({ success: true, data: report });
    });
  });

  // ---- entitlements_json writes ----

  describe('entitlements_json endpoints', () => {
    const SUB = '11111111-1111-4111-8111-111111111111';

    it('sets keys as the acting admin', async () => {
      entitlementService.setSubscriptionEntitlements.mockResolvedValue({} as any);

      await controller.setEntitlementsJson(
        SUB,
        { values: { aiAnswers: 15 } } as any,
        mockAdmin,
      );

      expect(
        entitlementService.setSubscriptionEntitlements,
      ).toHaveBeenCalledWith(SUB, { aiAnswers: 15 }, 'admin-1');
    });

    it('clears one key as the acting admin', async () => {
      entitlementService.clearSubscriptionEntitlement.mockResolvedValue({} as any);

      await controller.clearEntitlementsJsonKey(SUB, 'aiAnswers', mockAdmin);

      expect(
        entitlementService.clearSubscriptionEntitlement,
      ).toHaveBeenCalledWith(SUB, 'aiAnswers', 'admin-1');
    });

    it('prunes by exact value and returns the affected count', async () => {
      entitlementService.pruneSubscriptionEntitlementKey.mockResolvedValue({
        key: 'aiAnswers',
        valueEquals: 0,
        affectedCount: 9,
        subscriptionIds: ['s1'],
      } as any);

      const result = await controller.pruneEntitlementsJson(
        { key: 'aiAnswers', valueEquals: 0 } as any,
        mockAdmin,
      );

      expect(
        entitlementService.pruneSubscriptionEntitlementKey,
      ).toHaveBeenCalledWith('aiAnswers', 0, 'admin-1');
      expect(result.data.affectedCount).toBe(9);
    });

    it('scopes stored-key counts to a plan code when given', async () => {
      entitlementService.countStoredEntitlementKeys.mockResolvedValue({} as any);

      await controller.getStoredEntitlementKeyCounts('free');

      expect(entitlementService.countStoredEntitlementKeys).toHaveBeenCalledWith(
        'free',
      );
    });
  });
});
