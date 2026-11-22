import { Test, TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { UsersAdminController } from './users-admin.controller';
import { AccountSharingService } from './account-sharing/account-sharing.service';
import { UsersAdminService } from './users-admin.service';

describe('UsersAdminController', () => {
  let controller: UsersAdminController;
  let adminService: jest.Mocked<UsersAdminService>;
  const accountSharing = { report: jest.fn() };

  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersAdminController],
      providers: [
        {
          provide: UsersAdminService,
          useValue: {
            listUsers: jest.fn(),
            getUserDetail: jest.fn(),
          },
        },
        { provide: AccountSharingService, useValue: accountSharing },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(mockGuard)
      .overrideGuard(MfaGuard).useValue(mockGuard)
      .overrideGuard(TenantGuard).useValue(mockGuard)
      .overrideGuard(PermissionsGuard).useValue(mockGuard)
      .compile();

    controller = module.get<UsersAdminController>(UsersAdminController);
    adminService = module.get(UsersAdminService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listUsers', () => {
    it('should delegate to adminService.listUsers with default args', async () => {
      const mockResult = {
        data: [{ id: 'user-1' }],
        nextCursor: null,
        hasNext: false,
      };
      adminService.listUsers.mockResolvedValue(mockResult as never);

      const result = await controller.listUsers({} as never);

      expect(adminService.listUsers).toHaveBeenCalledWith({
        cursor: undefined,
        limit: undefined,
        search: undefined,
        status: undefined,
        role: undefined,
        planTier: undefined,
        hasActiveSubscription: undefined,
        sortBy: undefined,
        sortDir: undefined,
      });
      expect(result).toEqual({
        success: true,
        data: mockResult.data,
        nextCursor: null,
        hasNext: false,
      });
    });

    it('should pass filters through and coerce hasActiveSubscription "true" to boolean', async () => {
      adminService.listUsers.mockResolvedValue({
        data: [],
        nextCursor: null,
        hasNext: false,
      } as never);

      await controller.listUsers({
        cursor: 'user-5',
        limit: 50,
        search: 'jane',
        status: 'active',
        role: 'lawyer',
        planTier: 'pro',
        hasActiveSubscription: 'true',
        sortBy: 'email',
        sortDir: 'asc',
      } as never);

      expect(adminService.listUsers).toHaveBeenCalledWith({
        cursor: 'user-5',
        limit: 50,
        search: 'jane',
        status: 'active',
        role: 'lawyer',
        planTier: 'pro',
        hasActiveSubscription: true,
        sortBy: 'email',
        sortDir: 'asc',
      });
    });

    it('should coerce hasActiveSubscription "false" to boolean false', async () => {
      adminService.listUsers.mockResolvedValue({
        data: [],
        nextCursor: null,
        hasNext: false,
      } as never);

      await controller.listUsers({ hasActiveSubscription: 'false' } as never);

      expect(adminService.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ hasActiveSubscription: false }),
      );
    });
  });

  describe('getUserDetail', () => {
    it('should delegate to adminService.getUserDetail', async () => {
      const mockDetail = {
        id: 'user-1',
        email: 'a@example.com',
        memberships: [],
        subscriptions: [],
        payments: [],
        couponRedemptions: [],
        promotionRedemptions: [],
        complimentaryAccess: [],
        entitlementOverrides: [],
      };
      adminService.getUserDetail.mockResolvedValue(mockDetail as never);

      const result = await controller.getUserDetail('user-1');

      expect(adminService.getUserDetail).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ success: true, data: mockDetail });
    });
  });
  describe('sharingSignals', () => {
    it('defaults to a 24-hour window', async () => {
      accountSharing.report.mockResolvedValue({ signals: [] });
      await expect(controller.sharingSignals()).resolves.toEqual({
        success: true,
        data: { signals: [] },
      });
      expect(accountSharing.report).toHaveBeenCalledWith(24);
    });

    it('accepts 1-168 hours and rejects anything else', async () => {
      accountSharing.report.mockResolvedValue({ signals: [] });
      await controller.sharingSignals('72');
      expect(accountSharing.report).toHaveBeenCalledWith(72);
      for (const bad of ['0', '169', '1.5', 'abc']) {
        await expect(controller.sharingSignals(bad)).rejects.toMatchObject({ status: 400 });
      }
    });
  });
});
