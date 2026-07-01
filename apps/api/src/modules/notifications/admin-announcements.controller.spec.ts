import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { JwtPayload } from '@libertasian/types';

import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AdminAnnouncementsController } from './admin-announcements.controller';
import { NotificationsService } from './notifications.service';

const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

describe('AdminAnnouncementsController', () => {
  let controller: AdminAnnouncementsController;
  let prisma: { user: { findMany: jest.Mock } };
  let notificationsService: { sendAnnouncement: jest.Mock };
  let auditService: { log: jest.Mock };

  const USER = {
    sub: '00000000-0000-0000-0000-0000000000aa',
    organizationId: '00000000-0000-0000-0000-0000000000bb',
    email: 'admin@libertasian.com',
  } as JwtPayload;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]),
      },
    };
    notificationsService = { sendAnnouncement: jest.fn().mockResolvedValue(undefined) };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminAnnouncementsController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditService, useValue: auditService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(mockGuard)
      .overrideGuard(MfaGuard).useValue(mockGuard)
      .overrideGuard(TenantGuard).useValue(mockGuard)
      .overrideGuard(PermissionsGuard).useValue(mockGuard)
      .compile();

    controller = module.get<AdminAnnouncementsController>(AdminAnnouncementsController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('auth gate', () => {
    it('declares Jwt + Mfa + Tenant + Permissions guards via @UseGuards', () => {
      // Stripping any one of these would let org owners of free personal
      // orgs mass-email every user on the platform, so the spec pins the
      // declaration here.
      const guards = (Reflect.getMetadata(GUARDS_METADATA, AdminAnnouncementsController) ?? []) as unknown[];
      expect(guards).toEqual([JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard]);
    });

    it('requires the admin:settings platform permission', () => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, AdminAnnouncementsController)).toEqual({
        permissions: ['admin:settings'],
        mode: 'any',
      });
    });

    it('carries no org-role gate', () => {
      // The old @Roles('admin', 'owner') gate passed for every
      // self-registered user (each is owner of their personal org).
      expect(Reflect.getMetadata(ROLES_KEY, AdminAnnouncementsController)).toBeUndefined();
    });
  });

  describe('sendAnnouncement', () => {
    const dto = {
      subject: 'Maintenance window',
      title: 'Scheduled maintenance',
      content: '<p>We will be down briefly.</p><script>alert(1)</script>',
      targetAudience: 'all' as const,
    } as never;

    it('sanitizes content, enqueues batches, and logs audit', async () => {
      const result = await controller.sendAnnouncement(dto, USER);

      expect(result.success).toBe(true);
      expect(result.data.recipientCount).toBe(2);
      expect(notificationsService.sendAnnouncement).toHaveBeenCalledWith(
        expect.objectContaining({
          userIds: ['u1', 'u2'],
          subject: 'Maintenance window',
          content: expect.not.stringContaining('<script>'),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: USER.sub,
          action: 'admin.announcement_sent',
          metadata: expect.objectContaining({ targetAudience: 'all', recipientCount: 2 }),
        }),
      );
    });

    it('filters to subscribers when targetAudience is subscribers', async () => {
      await controller.sendAnnouncement({ ...(dto as object), targetAudience: 'subscribers' } as never, USER);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'active',
            memberships: expect.anything(),
          }),
        }),
      );
    });
  });
});
