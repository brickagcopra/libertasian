import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateOrganizationDto, UpdateOrganizationDto, InviteMemberDto } from './dto';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prismaService: PrismaService;
  let notificationsService: NotificationsService;

  const mockPrismaService = {
    organization: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    organizationMember: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    subscription: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    pendingInvite: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockNotificationsService = {
    sendMemberInviteEmail: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
    prismaService = module.get<PrismaService>(PrismaService);
    notificationsService = module.get<NotificationsService>(NotificationsService);

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create organization with owner membership and free subscription', async () => {
      const dto: CreateOrganizationDto = {
        name: 'Test Law Firm',
        type: 'firm',
      };
      const ownerUserId = 'user-123';

      const mockOrg = {
        id: 'org-123',
        name: 'Test Law Firm',
        slug: 'test-law-firm-abc123',
        type: 'firm',
        billingOwnerUserId: ownerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockMembership = {
        id: 'member-123',
        organizationId: 'org-123',
        userId: ownerUserId,
        role: 'owner',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockSubscription = {
        id: 'sub-123',
        organizationId: 'org-123',
        planCode: 'free',
        status: 'active',
        seats: 1,
        entitlementsJson: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.organization.create.mockResolvedValue(mockOrg);
      mockPrismaService.organizationMember.create.mockResolvedValue(mockMembership);
      mockPrismaService.subscription.create.mockResolvedValue(mockSubscription);

      const result = await service.create(dto, ownerUserId);

      expect(result).toEqual(mockOrg);
      expect(mockPrismaService.organization.create).toHaveBeenCalledWith({
        data: {
          name: 'Test Law Firm',
          slug: expect.stringContaining('test-law-firm-'),
          type: 'firm',
          billingOwnerUserId: ownerUserId,
        },
      });
      expect(mockPrismaService.organizationMember.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-123',
          userId: ownerUserId,
          role: 'owner',
          status: 'active',
        },
      });
      expect(mockPrismaService.subscription.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-123',
          planCode: 'free',
          status: 'active',
          seats: 1,
          entitlementsJson: {},
        },
      });
    });

    it('should trim organization name during creation', async () => {
      const dto: CreateOrganizationDto = {
        name: '  Test Law Firm  ',
      };
      const ownerUserId = 'user-123';

      const mockOrg = {
        id: 'org-123',
        name: 'Test Law Firm',
        slug: 'test-law-firm-abc123',
        type: 'firm',
        billingOwnerUserId: ownerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.organization.create.mockResolvedValue(mockOrg);
      mockPrismaService.organizationMember.create.mockResolvedValue({});
      mockPrismaService.subscription.create.mockResolvedValue({});

      await service.create(dto, ownerUserId);

      expect(mockPrismaService.organization.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Test Law Firm',
        }),
      });
    });
  });

  describe('findById', () => {
    it('should return organization with subscriptions and member count', async () => {
      const orgId = 'org-123';
      const mockOrg = {
        id: orgId,
        name: 'Test Law Firm',
        slug: 'test-law-firm-abc123',
        type: 'firm',
        billingOwnerUserId: 'user-123',
        createdAt: new Date(),
        updatedAt: new Date(),
        subscriptions: [
          {
            id: 'sub-123',
            planCode: 'pro',
            status: 'active',
            seats: 5,
          },
        ],
        _count: {
          members: 3,
        },
      };

      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrg);

      const result = await service.findById(orgId);

      expect(result).toEqual(mockOrg);
      expect(mockPrismaService.organization.findUnique).toHaveBeenCalledWith({
        where: { id: orgId },
        include: {
          subscriptions: {
            where: { status: 'active' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          _count: { select: { members: true } },
        },
      });
    });

    it('should throw NotFoundException when organization not found', async () => {
      const orgId = 'nonexistent-org';
      mockPrismaService.organization.findUnique.mockResolvedValue(null);

      await expect(service.findById(orgId)).rejects.toThrow(NotFoundException);
      await expect(service.findById(orgId)).rejects.toThrow('Organization not found');
    });
  });

  describe('findBySlug', () => {
    it('should return organization when found by slug', async () => {
      const slug = 'test-law-firm-abc123';
      const mockOrg = {
        id: 'org-123',
        name: 'Test Law Firm',
        slug,
        type: 'firm',
        billingOwnerUserId: 'user-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrg);

      const result = await service.findBySlug(slug);

      expect(result).toEqual(mockOrg);
      expect(mockPrismaService.organization.findUnique).toHaveBeenCalledWith({
        where: { slug },
      });
    });

    it('should throw NotFoundException when slug not found', async () => {
      const slug = 'nonexistent-slug';
      mockPrismaService.organization.findUnique.mockResolvedValue(null);

      await expect(service.findBySlug(slug)).rejects.toThrow(NotFoundException);
      await expect(service.findBySlug(slug)).rejects.toThrow('Organization not found');
    });
  });

  describe('update', () => {
    it('should update organization after role assertion', async () => {
      const orgId = 'org-123';
      const actorUserId = 'user-123';
      const dto: UpdateOrganizationDto = {
        name: 'Updated Law Firm',
      };

      const mockMembership = {
        id: 'member-123',
        organizationId: orgId,
        userId: actorUserId,
        role: 'owner',
        status: 'active',
      };

      const mockUpdatedOrg = {
        id: orgId,
        name: 'Updated Law Firm',
        slug: 'test-law-firm-abc123',
        type: 'firm',
        billingOwnerUserId: actorUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.organizationMember.findUnique.mockResolvedValue(mockMembership);
      mockPrismaService.organization.update.mockResolvedValue(mockUpdatedOrg);

      const result = await service.update(orgId, dto, actorUserId);

      expect(result).toEqual(mockUpdatedOrg);
      expect(mockPrismaService.organizationMember.findUnique).toHaveBeenCalledWith({
        where: {
          organizationId_userId: {
            organizationId: orgId,
            userId: actorUserId,
          },
        },
      });
      expect(mockPrismaService.organization.update).toHaveBeenCalledWith({
        where: { id: orgId },
        data: {
          name: 'Updated Law Firm',
        },
      });
    });

    it('should throw ForbiddenException when user lacks required role', async () => {
      const orgId = 'org-123';
      const actorUserId = 'user-123';
      const dto: UpdateOrganizationDto = {
        name: 'Updated Law Firm',
      };

      const mockMembership = {
        id: 'member-123',
        organizationId: orgId,
        userId: actorUserId,
        role: 'member',
        status: 'active',
      };

      mockPrismaService.organizationMember.findUnique.mockResolvedValue(mockMembership);

      await expect(service.update(orgId, dto, actorUserId)).rejects.toThrow(ForbiddenException);
      await expect(service.update(orgId, dto, actorUserId)).rejects.toThrow('Insufficient permissions');
      expect(mockPrismaService.organization.update).not.toHaveBeenCalled();
    });
  });

  describe('listMembers', () => {
    it('should return paginated members with hasNext false', async () => {
      const organizationId = 'org-123';
      const limit = 20;

      const mockMembers = [
        {
          id: 'member-1',
          organizationId,
          userId: 'user-1',
          role: 'owner',
          status: 'active',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          user: {
            id: 'user-1',
            email: 'owner@test.com',
            fullName: 'Owner User',
            status: 'active',
          },
        },
        {
          id: 'member-2',
          organizationId,
          userId: 'user-2',
          role: 'admin',
          status: 'active',
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
          user: {
            id: 'user-2',
            email: 'admin@test.com',
            fullName: 'Admin User',
            status: 'active',
          },
        },
      ];

      mockPrismaService.organizationMember.findMany.mockResolvedValue(mockMembers);

      const result = await service.listMembers(organizationId, undefined, limit);

      expect(result.items).toHaveLength(2);
      expect(result.meta.hasNext).toBe(false);
      expect(result.meta.nextCursor).toBeUndefined();
      expect(mockPrismaService.organizationMember.findMany).toHaveBeenCalledWith({
        where: { organizationId },
        take: limit + 1,
        orderBy: { createdAt: 'asc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
              status: true,
            },
          },
        },
      });
    });

    it('should return paginated members with hasNext true when limit exceeded', async () => {
      const organizationId = 'org-123';
      const limit = 2;

      const mockMembers = [
        {
          id: 'member-1',
          organizationId,
          userId: 'user-1',
          role: 'owner',
          status: 'active',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          user: { id: 'user-1', email: 'owner@test.com', fullName: 'Owner', status: 'active' },
        },
        {
          id: 'member-2',
          organizationId,
          userId: 'user-2',
          role: 'admin',
          status: 'active',
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
          user: { id: 'user-2', email: 'admin@test.com', fullName: 'Admin', status: 'active' },
        },
        {
          id: 'member-3',
          organizationId,
          userId: 'user-3',
          role: 'member',
          status: 'active',
          createdAt: new Date('2024-01-03'),
          updatedAt: new Date('2024-01-03'),
          user: { id: 'user-3', email: 'member@test.com', fullName: 'Member', status: 'active' },
        },
      ];

      mockPrismaService.organizationMember.findMany.mockResolvedValue(mockMembers);

      const result = await service.listMembers(organizationId, undefined, limit);

      expect(result.items).toHaveLength(2);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.nextCursor).toBe('member-2');
    });
  });

  describe('updateMemberRole', () => {
    it('should successfully update member role when actor is owner', async () => {
      const organizationId = 'org-123';
      const targetUserId = 'user-target';
      const actorUserId = 'user-owner';
      const newRole = 'admin';

      const mockActorMembership = {
        id: 'member-actor',
        organizationId,
        userId: actorUserId,
        role: 'owner',
        status: 'active',
      };

      const mockTargetMembership = {
        id: 'member-target',
        organizationId,
        userId: targetUserId,
        role: 'member',
        status: 'active',
      };

      const mockUpdatedMembership = {
        ...mockTargetMembership,
        role: newRole,
      };

      mockPrismaService.organizationMember.findUnique
        .mockResolvedValueOnce(mockActorMembership)
        .mockResolvedValueOnce(mockTargetMembership)
        .mockResolvedValueOnce(mockActorMembership);

      mockPrismaService.organizationMember.update.mockResolvedValue(mockUpdatedMembership);

      const result = await service.updateMemberRole(organizationId, targetUserId, newRole, actorUserId);

      expect(result).toEqual(mockUpdatedMembership);
      expect(mockPrismaService.organizationMember.update).toHaveBeenCalledWith({
        where: { id: mockTargetMembership.id },
        data: { role: newRole },
      });
    });

    it('should throw ForbiddenException when trying to assign owner role', async () => {
      const organizationId = 'org-123';
      const targetUserId = 'user-target';
      const actorUserId = 'user-owner';
      const newRole = 'owner';

      const mockActorMembership = {
        id: 'member-actor',
        organizationId,
        userId: actorUserId,
        role: 'owner',
        status: 'active',
      };

      mockPrismaService.organizationMember.findUnique.mockResolvedValue(mockActorMembership);

      await expect(
        service.updateMemberRole(organizationId, targetUserId, newRole, actorUserId)
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.updateMemberRole(organizationId, targetUserId, newRole, actorUserId)
      ).rejects.toThrow('Cannot assign owner role. Use transfer ownership.');
    });

    it('should throw ForbiddenException when trying to change owner role', async () => {
      const organizationId = 'org-123';
      const targetUserId = 'user-owner';
      const actorUserId = 'user-admin';
      const newRole = 'admin';

      const mockActorMembership = {
        id: 'member-actor',
        organizationId,
        userId: actorUserId,
        role: 'owner',
        status: 'active',
      };

      const mockTargetMembership = {
        id: 'member-target',
        organizationId,
        userId: targetUserId,
        role: 'owner',
        status: 'active',
      };

      mockPrismaService.organizationMember.findUnique
        .mockResolvedValueOnce(mockActorMembership)
        .mockResolvedValueOnce(mockTargetMembership);

      await expect(
        service.updateMemberRole(organizationId, targetUserId, newRole, actorUserId)
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.updateMemberRole(organizationId, targetUserId, newRole, actorUserId)
      ).rejects.toThrow('Cannot change the owner role');
    });

    it('should throw ForbiddenException when admin tries to promote to admin', async () => {
      const organizationId = 'org-123';
      const targetUserId = 'user-target';
      const actorUserId = 'user-admin';
      const newRole = 'admin';

      const mockActorMembership = {
        id: 'member-actor',
        organizationId,
        userId: actorUserId,
        role: 'admin',
        status: 'active',
      };

      const mockTargetMembership = {
        id: 'member-target',
        organizationId,
        userId: targetUserId,
        role: 'member',
        status: 'active',
      };

      mockPrismaService.organizationMember.findUnique
        .mockResolvedValueOnce(mockActorMembership)
        .mockResolvedValueOnce(mockTargetMembership)
        .mockResolvedValueOnce(mockActorMembership);

      await expect(
        service.updateMemberRole(organizationId, targetUserId, newRole, actorUserId)
      ).rejects.toThrow('Admins cannot promote other members to admin');
    });

    it('should throw NotFoundException when target member not found', async () => {
      const organizationId = 'org-123';
      const targetUserId = 'user-nonexistent';
      const actorUserId = 'user-owner';
      const newRole = 'admin';

      const mockActorMembership = {
        id: 'member-actor',
        organizationId,
        userId: actorUserId,
        role: 'owner',
        status: 'active',
      };

      mockPrismaService.organizationMember.findUnique
        .mockResolvedValueOnce(mockActorMembership)
        .mockResolvedValueOnce(null);

      await expect(
        service.updateMemberRole(organizationId, targetUserId, newRole, actorUserId)
      ).rejects.toThrow('Member not found');
    });
  });

  describe('removeMember', () => {
    it('should successfully remove member when actor is owner', async () => {
      const organizationId = 'org-123';
      const targetUserId = 'user-target';
      const actorUserId = 'user-owner';

      const mockActorMembership = {
        id: 'member-actor',
        organizationId,
        userId: actorUserId,
        role: 'owner',
        status: 'active',
      };

      const mockTargetMembership = {
        id: 'member-target',
        organizationId,
        userId: targetUserId,
        role: 'member',
        status: 'active',
      };

      mockPrismaService.organizationMember.findUnique
        .mockResolvedValueOnce(mockActorMembership)
        .mockResolvedValueOnce(mockTargetMembership);

      mockPrismaService.organizationMember.delete.mockResolvedValue(mockTargetMembership);

      await service.removeMember(organizationId, targetUserId, actorUserId);

      expect(mockPrismaService.organizationMember.delete).toHaveBeenCalledWith({
        where: { id: mockTargetMembership.id },
      });
    });

    it('should throw ForbiddenException when trying to remove owner', async () => {
      const organizationId = 'org-123';
      const targetUserId = 'user-owner';
      const actorUserId = 'user-admin';

      const mockActorMembership = {
        id: 'member-actor',
        organizationId,
        userId: actorUserId,
        role: 'owner',
        status: 'active',
      };

      const mockTargetMembership = {
        id: 'member-target',
        organizationId,
        userId: targetUserId,
        role: 'owner',
        status: 'active',
      };

      mockPrismaService.organizationMember.findUnique
        .mockResolvedValueOnce(mockActorMembership)
        .mockResolvedValueOnce(mockTargetMembership);

      await expect(
        service.removeMember(organizationId, targetUserId, actorUserId)
      ).rejects.toThrow('Cannot remove the organization owner');
    });

    it('should throw ForbiddenException when admin tries to remove another admin', async () => {
      const organizationId = 'org-123';
      const targetUserId = 'user-target-admin';
      const actorUserId = 'user-admin';

      const mockActorMembership = {
        id: 'member-actor',
        organizationId,
        userId: actorUserId,
        role: 'admin',
        status: 'active',
      };

      const mockTargetMembership = {
        id: 'member-target',
        organizationId,
        userId: targetUserId,
        role: 'admin',
        status: 'active',
      };

      mockPrismaService.organizationMember.findUnique
        .mockResolvedValueOnce(mockActorMembership)
        .mockResolvedValueOnce(mockTargetMembership)
        .mockResolvedValueOnce(mockActorMembership);

      await expect(
        service.removeMember(organizationId, targetUserId, actorUserId)
      ).rejects.toThrow('Only the owner can remove admins');
    });

    it('should allow owner to remove admin', async () => {
      const organizationId = 'org-123';
      const targetUserId = 'user-target-admin';
      const actorUserId = 'user-owner';

      const mockActorMembership = {
        id: 'member-actor',
        organizationId,
        userId: actorUserId,
        role: 'owner',
        status: 'active',
      };

      const mockTargetMembership = {
        id: 'member-target',
        organizationId,
        userId: targetUserId,
        role: 'admin',
        status: 'active',
      };

      mockPrismaService.organizationMember.findUnique
        .mockResolvedValueOnce(mockActorMembership)
        .mockResolvedValueOnce(mockTargetMembership)
        .mockResolvedValueOnce(mockActorMembership);

      mockPrismaService.organizationMember.delete.mockResolvedValue(mockTargetMembership);

      await service.removeMember(organizationId, targetUserId, actorUserId);

      expect(mockPrismaService.organizationMember.delete).toHaveBeenCalledWith({
        where: { id: mockTargetMembership.id },
      });
    });

    it('should throw NotFoundException when target member not found', async () => {
      const organizationId = 'org-123';
      const targetUserId = 'user-nonexistent';
      const actorUserId = 'user-owner';

      const mockActorMembership = {
        id: 'member-actor',
        organizationId,
        userId: actorUserId,
        role: 'owner',
        status: 'active',
      };

      mockPrismaService.organizationMember.findUnique
        .mockResolvedValueOnce(mockActorMembership)
        .mockResolvedValueOnce(null);

      await expect(
        service.removeMember(organizationId, targetUserId, actorUserId)
      ).rejects.toThrow('Member not found');
    });
  });

  describe('assertRole', () => {
    it('should not throw when user has required role', async () => {
      const organizationId = 'org-123';
      const userId = 'user-123';
      const requiredRoles = ['owner', 'admin'];

      const mockMembership = {
        id: 'member-123',
        organizationId,
        userId,
        role: 'owner',
        status: 'active',
      };

      mockPrismaService.organizationMember.findUnique.mockResolvedValue(mockMembership);

      await expect(service.assertRole(organizationId, userId, requiredRoles)).resolves.not.toThrow();

      expect(mockPrismaService.organizationMember.findUnique).toHaveBeenCalledWith({
        where: {
          organizationId_userId: {
            organizationId,
            userId,
          },
        },
      });
    });

    it('should throw ForbiddenException when user is not a member', async () => {
      const organizationId = 'org-123';
      const userId = 'user-123';
      const requiredRoles = ['owner', 'admin'];

      mockPrismaService.organizationMember.findUnique.mockResolvedValue(null);

      await expect(service.assertRole(organizationId, userId, requiredRoles)).rejects.toThrow(
        ForbiddenException
      );
      await expect(service.assertRole(organizationId, userId, requiredRoles)).rejects.toThrow(
        'Not a member of this organization'
      );
    });

    it('should throw ForbiddenException when user status is not active', async () => {
      const organizationId = 'org-123';
      const userId = 'user-123';
      const requiredRoles = ['owner', 'admin'];

      const mockMembership = {
        id: 'member-123',
        organizationId,
        userId,
        role: 'owner',
        status: 'inactive',
      };

      mockPrismaService.organizationMember.findUnique.mockResolvedValue(mockMembership);

      await expect(service.assertRole(organizationId, userId, requiredRoles)).rejects.toThrow(
        ForbiddenException
      );
      await expect(service.assertRole(organizationId, userId, requiredRoles)).rejects.toThrow(
        'Not a member of this organization'
      );
    });

    it('should throw ForbiddenException when user lacks required role', async () => {
      const organizationId = 'org-123';
      const userId = 'user-123';
      const requiredRoles = ['owner', 'admin'];

      const mockMembership = {
        id: 'member-123',
        organizationId,
        userId,
        role: 'member',
        status: 'active',
      };

      mockPrismaService.organizationMember.findUnique.mockResolvedValue(mockMembership);

      await expect(service.assertRole(organizationId, userId, requiredRoles)).rejects.toThrow(
        ForbiddenException
      );
      await expect(service.assertRole(organizationId, userId, requiredRoles)).rejects.toThrow(
        'Insufficient permissions'
      );
    });

    it('should succeed when user has one of multiple required roles', async () => {
      const organizationId = 'org-123';
      const userId = 'user-123';
      const requiredRoles = ['owner', 'admin', 'editor'];

      const mockMembership = {
        id: 'member-123',
        organizationId,
        userId,
        role: 'editor',
        status: 'active',
      };

      mockPrismaService.organizationMember.findUnique.mockResolvedValue(mockMembership);

      await expect(service.assertRole(organizationId, userId, requiredRoles)).resolves.not.toThrow();
    });
  });

  describe('inviteMember', () => {
    it('should create membership and send notification when user exists', async () => {
      const organizationId = 'org-123';
      const inviterUserId = 'user-inviter';
      const dto: InviteMemberDto = {
        email: 'newuser@test.com',
        role: 'member',
      };

      const mockInviterMembership = {
        id: 'member-inviter',
        organizationId,
        userId: inviterUserId,
        role: 'owner',
        status: 'active',
      };

      const mockInvitedUser = {
        id: 'user-invited',
        email: 'newuser@test.com',
        fullName: 'New User',
        status: 'active',
      };

      const mockOrg = {
        id: organizationId,
        name: 'Test Law Firm',
        slug: 'test-law-firm',
      };

      const mockInviter = {
        id: inviterUserId,
        fullName: 'Inviter User',
      };

      const mockSubscription = {
        id: 'sub-123',
        organizationId,
        planCode: 'pro',
        status: 'active',
        seats: 10,
      };

      const mockCreatedMember = {
        id: 'member-new',
        organizationId,
        userId: mockInvitedUser.id,
        role: 'member',
        status: 'active',
      };

      mockPrismaService.organizationMember.findUnique
        .mockResolvedValueOnce(mockInviterMembership)
        .mockResolvedValueOnce(null);

      mockPrismaService.subscription.findFirst.mockResolvedValue(mockSubscription);
      mockPrismaService.organizationMember.count.mockResolvedValue(3);
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce(mockInvitedUser)
        .mockResolvedValueOnce(mockInviter);

      mockPrismaService.organizationMember.create.mockResolvedValue(mockCreatedMember);
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrg);

      const result = await service.inviteMember(organizationId, dto, inviterUserId);

      expect(result).toEqual(mockCreatedMember);
      expect(mockNotificationsService.sendMemberInviteEmail).toHaveBeenCalledWith(
        'newuser@test.com',
        'New User',
        'Test Law Firm',
        'Inviter User'
      );
    });

    it('should create pending invite when user does not exist', async () => {
      const organizationId = 'org-123';
      const inviterUserId = 'user-inviter';
      const dto: InviteMemberDto = {
        email: 'nonexistent@test.com',
        role: 'member',
      };

      const mockInviterMembership = {
        id: 'member-inviter',
        organizationId,
        userId: inviterUserId,
        role: 'owner',
        status: 'active',
      };

      const mockSubscription = {
        id: 'sub-123',
        organizationId,
        planCode: 'pro',
        status: 'active',
        seats: 10,
      };

      const mockOrg = {
        id: organizationId,
        name: 'Test Law Firm',
      };

      const mockInviter = {
        id: inviterUserId,
        fullName: 'Inviter User',
      };

      const mockPendingInvite = {
        id: 'invite-123',
        organizationId,
        email: 'nonexistent@test.com',
        role: 'member',
        tokenHash: 'hashed-token',
        invitedBy: inviterUserId,
        expiresAt: new Date(),
        acceptedAt: null,
      };

      // assertRole needs organizationMember.findUnique for inviter
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce(mockInviterMembership);
      mockPrismaService.subscription.findFirst.mockResolvedValue(mockSubscription);
      mockPrismaService.organizationMember.count.mockResolvedValue(3);
      // 1st call: invitedUser lookup (null = not found), 2nd call: inviter in Promise.all
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockInviter);

      mockPrismaService.pendingInvite.findUnique.mockResolvedValue(null);
      mockPrismaService.pendingInvite.create.mockResolvedValue(mockPendingInvite);
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrg);

      const result = await service.inviteMember(organizationId, dto, inviterUserId);

      expect(result).toEqual({
        id: mockPendingInvite.id,
        pending: true,
        email: 'nonexistent@test.com',
      });
      expect(mockNotificationsService.sendMemberInviteEmail).toHaveBeenCalledWith(
        'nonexistent@test.com',
        'New User',
        'Test Law Firm',
        'Inviter User'
      );
    });

    it('should throw ConflictException when user is already a member', async () => {
      const organizationId = 'org-123';
      const inviterUserId = 'user-inviter';
      const dto: InviteMemberDto = {
        email: 'existing@test.com',
        role: 'member',
      };

      const mockInviterMembership = {
        id: 'member-inviter',
        organizationId,
        userId: inviterUserId,
        role: 'owner',
        status: 'active',
      };

      const mockInvitedUser = {
        id: 'user-existing',
        email: 'existing@test.com',
      };

      const mockExistingMembership = {
        id: 'member-existing',
        organizationId,
        userId: mockInvitedUser.id,
        role: 'member',
        status: 'active',
      };

      const mockSubscription = {
        id: 'sub-123',
        organizationId,
        planCode: 'pro',
        status: 'active',
        seats: 10,
      };

      mockPrismaService.organizationMember.findUnique
        .mockResolvedValueOnce(mockInviterMembership)
        .mockResolvedValueOnce(mockExistingMembership);

      mockPrismaService.subscription.findFirst.mockResolvedValue(mockSubscription);
      mockPrismaService.organizationMember.count.mockResolvedValue(3);
      mockPrismaService.user.findUnique.mockResolvedValue(mockInvitedUser);

      await expect(
        service.inviteMember(organizationId, dto, inviterUserId)
      ).rejects.toThrow('User is already a member of this organization');
    });
  });
});
