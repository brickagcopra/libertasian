import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { UsersAdminService } from './users-admin.service';

describe('UsersAdminService', () => {
  let service: UsersAdminService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      organizationMember: {
        findMany: jest.fn(),
      },
      payment: {
        findMany: jest.fn(),
        groupBy: jest.fn(),
      },
      subscription: {
        findMany: jest.fn(),
      },
      couponRedemption: {
        findMany: jest.fn(),
      },
      promotionRedemption: {
        findMany: jest.fn(),
      },
      complimentaryAccess: {
        findMany: jest.fn(),
      },
      entitlementOverride: {
        findMany: jest.fn(),
      },
      loginEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersAdminService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<UsersAdminService>(UsersAdminService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const baseUserSelect = (overrides: Record<string, unknown> = {}) => ({
    id: 'user-1',
    email: 'jane@example.com',
    fullName: 'Jane Doe',
    status: 'active',
    userRole: 'lawyer',
    emailVerified: true,
    mfaEnabled: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lastLoginAt: null,
    lastLoginIp: null,
    lastLoginCountry: null,
    lastLoginCity: null,
    lastLoginRegion: null,
    ...overrides,
  });

  // ─── listUsers ───────────────────────────────────────────

  describe('listUsers', () => {
    it('returns empty result with no users found', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.listUsers({});

      expect(result).toEqual({ data: [], nextCursor: null, hasNext: false });
      // No batched queries should fire when there are no userIds.
      expect(prisma.organizationMember.findMany).not.toHaveBeenCalled();
      expect(prisma.payment.groupBy).not.toHaveBeenCalled();
    });

    it('paginates with default limit and sets hasNext + nextCursor', async () => {
      const users = Array.from({ length: 21 }, (_, i) =>
        baseUserSelect({ id: `user-${i}`, email: `u${i}@example.com` }),
      );
      prisma.user.findMany.mockResolvedValue(users);
      prisma.organizationMember.findMany.mockResolvedValue([]);
      prisma.payment.groupBy.mockResolvedValue([]);

      const result = await service.listUsers({});

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 21,
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result.data).toHaveLength(20);
      expect(result.hasNext).toBe(true);
      expect(result.nextCursor).toBe('user-19');
    });

    it('applies search filter as OR over email + fullName', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.listUsers({ search: 'jane' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { email: { contains: 'jane', mode: 'insensitive' } },
              { fullName: { contains: 'jane', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('applies status, role, and planTier filters', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.listUsers({
        status: 'suspended',
        role: 'student',
        planTier: 'pro',
      });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'suspended',
            userRole: 'student',
            memberships: {
              some: {
                organization: {
                  subscriptions: { some: { planCode: 'pro' } },
                },
              },
            },
          }),
        }),
      );
    });

    it('applies hasActiveSubscription filter combined with planTier', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.listUsers({
        planTier: 'pro',
        hasActiveSubscription: true,
      });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            memberships: {
              some: {
                organization: {
                  subscriptions: {
                    some: expect.objectContaining({
                      planCode: 'pro',
                      status: expect.objectContaining({
                        in: expect.arrayContaining(['active', 'trialing']),
                      }),
                    }),
                  },
                },
              },
            },
          }),
        }),
      );
    });

    it('honors sortBy=email + sortDir=asc', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.listUsers({ sortBy: 'email', sortDir: 'asc' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { email: 'asc' } }),
      );
    });

    it('uses cursor for pagination', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.listUsers({ cursor: 'user-10' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          cursor: { id: 'user-10' },
        }),
      );
    });

    it('aggregates LTV across user orgs from payment.groupBy (no N+1)', async () => {
      prisma.user.findMany.mockResolvedValue([baseUserSelect()]);
      prisma.organizationMember.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          organizationId: 'org-A',
          organization: {
            id: 'org-A',
            name: 'Acme',
            subscriptions: [],
          },
        },
        {
          userId: 'user-1',
          organizationId: 'org-B',
          organization: {
            id: 'org-B',
            name: 'Beta',
            subscriptions: [],
          },
        },
      ]);
      prisma.payment.groupBy.mockResolvedValue([
        { organizationId: 'org-A', _sum: { amount: 4500 } },
        { organizationId: 'org-B', _sum: { amount: 12000 } },
      ]);

      const result = await service.listUsers({});

      expect(prisma.payment.groupBy).toHaveBeenCalledTimes(1);
      expect(prisma.payment.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['organizationId'],
          where: expect.objectContaining({ status: 'succeeded' }),
        }),
      );
      expect(result.data[0]!.lifetimeValueCentavos).toBe(16500);
      expect(result.data[0]!.primaryOrgName).toBe('Acme');
    });

    it('returns lastLoginCity + lastLoginRegion in list rows', async () => {
      prisma.user.findMany.mockResolvedValue([
        baseUserSelect({
          lastLoginAt: new Date('2026-05-01T12:00:00Z'),
          lastLoginIp: '203.0.113.10',
          lastLoginCountry: 'PH',
          lastLoginCity: 'Manila',
          lastLoginRegion: 'NCR',
        }),
      ]);
      prisma.organizationMember.findMany.mockResolvedValue([]);
      prisma.payment.groupBy.mockResolvedValue([]);

      const result = await service.listUsers({});

      expect(result.data[0]).toMatchObject({
        lastLoginCountry: 'PH',
        lastLoginCity: 'Manila',
        lastLoginRegion: 'NCR',
      });
      // Service must request the new columns in the select so Prisma populates them.
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            lastLoginCity: true,
            lastLoginRegion: true,
          }),
        }),
      );
    });

    it('picks the active subscription as currentPlanCode over inactive ones', async () => {
      prisma.user.findMany.mockResolvedValue([baseUserSelect()]);
      prisma.organizationMember.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          organizationId: 'org-A',
          organization: {
            id: 'org-A',
            name: 'Acme',
            subscriptions: [
              {
                planCode: 'free',
                status: 'cancelled',
                createdAt: new Date('2026-01-01'),
              },
              {
                planCode: 'pro',
                status: 'active',
                createdAt: new Date('2025-01-01'),
              },
            ],
          },
        },
      ]);
      prisma.payment.groupBy.mockResolvedValue([]);

      const result = await service.listUsers({});

      expect(result.data[0]!.currentPlanCode).toBe('pro');
      expect(result.data[0]!.subscriptionStatus).toBe('active');
    });
  });

  // ─── getUserDetail ───────────────────────────────────────

  describe('getUserDetail', () => {
    it('throws NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserDetail('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns a fully shaped detail object with signupSource=google when googleId is set', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'g@example.com',
        fullName: 'Gee',
        phone: null,
        status: 'active',
        emailVerified: true,
        mfaEnabled: false,
        userRole: 'lawyer',
        googleId: 'google-xyz',
        onboardingCompletedAt: new Date('2026-01-01'),
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
        lastLoginAt: new Date('2026-05-01T12:00:00Z'),
        lastLoginIp: '203.0.113.10',
        lastLoginCountry: 'PH',
        lastLoginCity: 'Manila',
        lastLoginRegion: 'NCR',
        memberships: [
          {
            organizationId: 'org-A',
            role: 'admin',
            status: 'active',
            createdAt: new Date('2026-01-01'),
            organization: { id: 'org-A', name: 'Acme', slug: 'acme' },
          },
        ],
        expertVerification: null,
        emailPreference: null,
      });
      prisma.subscription.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          organizationId: 'org-A',
          planCode: 'pro',
          status: 'active',
          billingPeriod: 'monthly',
          currentPeriodStart: new Date('2026-01-01'),
          currentPeriodEnd: new Date('2026-02-01'),
          trialStart: null,
          trialEnd: null,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          createdAt: new Date('2026-01-01'),
          organization: { name: 'Acme' },
          plan: { name: 'Pro' },
        },
      ]);
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.couponRedemption.findMany.mockResolvedValue([]);
      prisma.promotionRedemption.findMany.mockResolvedValue([]);
      prisma.complimentaryAccess.findMany.mockResolvedValue([]);
      prisma.entitlementOverride.findMany.mockResolvedValue([]);

      const result = await service.getUserDetail('user-1');

      expect(result.signupSource).toBe('google');
      expect(result.memberships).toHaveLength(1);
      expect(result.memberships[0]).toMatchObject({
        organizationName: 'Acme',
        organizationSlug: 'acme',
        role: 'admin',
      });
      expect(result.subscriptions).toHaveLength(1);
      expect(result.subscriptions[0]!.planName).toBe('Pro');
      // 50-item cap is enforced at the query level; just confirm we asked for it.
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
      expect(result.lastLoginAt).toEqual(new Date('2026-05-01T12:00:00Z'));
      expect(result.lastLoginCountry).toBe('PH');
      expect(result.lastLoginCity).toBe('Manila');
      expect(result.lastLoginRegion).toBe('NCR');
      expect(result.lastLoginIp).toBe('203.0.113.10');
      expect(result.loginHistory).toEqual([]);
    });

    it('returns signupSource=password when googleId is null', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-2',
        email: 'p@example.com',
        fullName: 'Pee',
        phone: null,
        status: 'active',
        emailVerified: true,
        mfaEnabled: true,
        userRole: null,
        googleId: null,
        onboardingCompletedAt: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        lastLoginAt: null,
        lastLoginIp: null,
        lastLoginCountry: null,
        lastLoginCity: null,
        lastLoginRegion: null,
        memberships: [],
        expertVerification: null,
        emailPreference: null,
      });
      prisma.couponRedemption.findMany.mockResolvedValue([]);
      prisma.promotionRedemption.findMany.mockResolvedValue([]);

      const result = await service.getUserDetail('user-2');

      expect(result.signupSource).toBe('password');
      expect(result.memberships).toEqual([]);
      // With no orgs, org-scoped queries should NOT have been issued.
      expect(prisma.subscription.findMany).not.toHaveBeenCalled();
      expect(prisma.payment.findMany).not.toHaveBeenCalled();
      expect(prisma.complimentaryAccess.findMany).not.toHaveBeenCalled();
      expect(prisma.entitlementOverride.findMany).not.toHaveBeenCalled();
    });

    it('returns loginHistory ordered desc by createdAt and capped at 20', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-3',
        email: 'h@example.com',
        fullName: 'Hist',
        phone: null,
        status: 'active',
        emailVerified: true,
        mfaEnabled: false,
        userRole: null,
        googleId: null,
        onboardingCompletedAt: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        lastLoginAt: new Date('2026-05-10'),
        lastLoginIp: '198.51.100.7',
        lastLoginCountry: 'US',
        memberships: [],
        expertVerification: null,
        emailPreference: null,
      });
      prisma.couponRedemption.findMany.mockResolvedValue([]);
      prisma.promotionRedemption.findMany.mockResolvedValue([]);
      prisma.loginEvent.findMany.mockResolvedValue([
        {
          id: 'ev-2',
          eventType: 'login_success',
          ipAddress: '198.51.100.7',
          userAgent: 'Mozilla/5.0',
          country: 'US',
          region: 'CA',
          city: 'San Francisco',
          failureReason: null,
          createdAt: new Date('2026-05-10T08:00:00Z'),
        },
        {
          id: 'ev-1',
          eventType: 'login_success',
          ipAddress: '198.51.100.7',
          userAgent: 'Mozilla/5.0',
          country: 'US',
          region: 'CA',
          city: 'San Francisco',
          failureReason: null,
          createdAt: new Date('2026-05-09T08:00:00Z'),
        },
      ]);

      const result = await service.getUserDetail('user-3');

      expect(prisma.loginEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-3' },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      );
      expect(result.loginHistory).toHaveLength(2);
      expect(result.loginHistory[0]!.id).toBe('ev-2');
      expect(result.loginHistory[0]!.country).toBe('US');
      expect(result.loginHistory[1]!.id).toBe('ev-1');
    });
  });
});
