import { Test, TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { UsersAdminController } from './users-admin.controller';
import { UsersAdminService } from './users-admin.service';

describe('UsersAdminController', () => {
  let controller: UsersAdminController;
  let adminService: jest.Mocked<UsersAdminService>;

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
});
