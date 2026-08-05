import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { AdminUserDetailDto } from './dto/admin-user-detail.dto';
import type { AdminUserListItemDto } from './dto/admin-user-list-item.dto';

export interface ListAdminUsersParams {
  cursor?: string;
  limit?: number;
  search?: string;
  status?: string;
  role?: string;
  planTier?: string;
  hasActiveSubscription?: boolean;
  sortBy?: 'createdAt' | 'email';
  sortDir?: 'asc' | 'desc';
}

const ACTIVE_SUB_STATUSES = ['active', 'trialing', 'complimentary', 'grace_period'];

@Injectable()
export class UsersAdminService {
  private readonly logger = new Logger(UsersAdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cursor-paginated list of users with org/plan/LTV aggregates.
   * Performs ONE batched query per related table after the initial user fetch
   * to avoid N+1.
   */
  async listUsers(params: ListAdminUsersParams) {
    const limit = params.limit ?? 20;
    const sortBy = params.sortBy ?? 'createdAt';
    const sortDir = params.sortDir ?? 'desc';

    const where: Prisma.UserWhereInput = {};

    if (params.search) {
      where.OR = [
        { email: { contains: params.search, mode: 'insensitive' } },
        { fullName: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.status) where.status = params.status;
    if (params.role) where.userRole = params.role;

    if (params.planTier || params.hasActiveSubscription === true) {
      const subFilter: Prisma.SubscriptionWhereInput = {};
      if (params.planTier) subFilter.planCode = params.planTier;
      if (params.hasActiveSubscription === true) {
        subFilter.status = { in: ACTIVE_SUB_STATUSES };
      }
      where.memberships = {
        some: {
          organization: {
            subscriptions: { some: subFilter },
          },
        },
      };
    }

    const orderBy: Prisma.UserOrderByWithRelationInput =
      sortBy === 'email' ? { email: sortDir } : { createdAt: sortDir };

    const users = await this.prisma.user.findMany({
      where,
      take: limit + 1,
      ...(params.cursor && { skip: 1, cursor: { id: params.cursor } }),
      orderBy,
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        userRole: true,
        emailVerified: true,
        mfaEnabled: true,
        createdAt: true,
        lastLoginAt: true,
        lastLoginIp: true,
        lastLoginCountry: true,
        lastLoginCity: true,
        lastLoginRegion: true,
      },
    });

    const hasNext = users.length > limit;
    const sliced = hasNext ? users.slice(0, limit) : users;
    const lastItem = sliced[sliced.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : null;

    const userIds = sliced.map((u) => u.id);

    if (userIds.length === 0) {
      return { data: [] as AdminUserListItemDto[], nextCursor, hasNext };
    }

    // ONE batched query each: memberships (with org + subscriptions) and LTV.
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId: { in: userIds } },
      orderBy: { createdAt: 'asc' },
      select: {
        userId: true,
        organizationId: true,
        organization: {
          select: {
            id: true,
            name: true,
            subscriptions: {
              orderBy: { createdAt: 'desc' },
              select: {
                planCode: true,
                status: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    const orgIds = [
      ...new Set(memberships.map((m) => m.organizationId)),
    ];

    const ltvByOrg = new Map<string, number>();
    if (orgIds.length > 0) {
      const ltvRows = await this.prisma.payment.groupBy({
        by: ['organizationId'],
        where: {
          organizationId: { in: orgIds },
          status: 'succeeded',
        },
        _sum: { amount: true },
      });
      for (const row of ltvRows) {
        ltvByOrg.set(row.organizationId, row._sum.amount ?? 0);
      }
    }

    const membershipsByUser = new Map<string, typeof memberships>();
    for (const m of memberships) {
      const arr = membershipsByUser.get(m.userId) ?? [];
      arr.push(m);
      membershipsByUser.set(m.userId, arr);
    }

    const data: AdminUserListItemDto[] = sliced.map((u) => {
      const mships = membershipsByUser.get(u.id) ?? [];
      const primaryOrgName = mships[0]?.organization.name ?? null;

      let bestSub: { planCode: string; status: string; createdAt: Date } | null = null;
      for (const m of mships) {
        for (const s of m.organization.subscriptions) {
          if (!bestSub) {
            bestSub = s;
            continue;
          }
          const bestActive = ACTIVE_SUB_STATUSES.includes(bestSub.status);
          const curActive = ACTIVE_SUB_STATUSES.includes(s.status);
          if (curActive && !bestActive) {
            bestSub = s;
          } else if (curActive === bestActive && s.createdAt > bestSub.createdAt) {
            bestSub = s;
          }
        }
      }

      let lifetimeValueCentavos = 0;
      const seenOrgs = new Set<string>();
      for (const m of mships) {
        if (seenOrgs.has(m.organizationId)) continue;
        seenOrgs.add(m.organizationId);
        lifetimeValueCentavos += ltvByOrg.get(m.organizationId) ?? 0;
      }

      return {
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        status: u.status,
        userRole: u.userRole,
        emailVerified: u.emailVerified,
        mfaEnabled: u.mfaEnabled,
        createdAt: u.createdAt,
        primaryOrgName,
        currentPlanCode: bestSub?.planCode ?? null,
        subscriptionStatus: bestSub?.status ?? null,
        subscriptionStartedAt: bestSub?.createdAt ?? null,
        lifetimeValueCentavos,
        lastLoginAt: u.lastLoginAt,
        lastLoginCountry: u.lastLoginCountry,
        lastLoginCity: u.lastLoginCity,
        lastLoginRegion: u.lastLoginRegion,
        lastLoginIp: u.lastLoginIp,
      };
    });

    return { data, nextCursor, hasNext };
  }

  /**
   * Full user detail across all related domains. Batches one query per related
   * table keyed by userId / organizationId.
   */
  async getUserDetail(id: string): Promise<AdminUserDetailDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        status: true,
        emailVerified: true,
        mfaEnabled: true,
        userRole: true,
        googleId: true,
        onboardingCompletedAt: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
        lastLoginIp: true,
        lastLoginCountry: true,
        lastLoginCity: true,
        lastLoginRegion: true,
        memberships: {
          orderBy: { createdAt: 'asc' },
          select: {
            organizationId: true,
            role: true,
            status: true,
            createdAt: true,
            organization: {
              select: { id: true, name: true, slug: true },
            },
          },
        },
        expertVerification: {
          select: {
            expertiseType: true,
            status: true,
            reviewedAt: true,
            createdAt: true,
          },
        },
        emailPreference: {
          select: {
            transactional: true,
            subscriptionUpdates: true,
            announcements: true,
            blogNotifications: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    const orgIds = user.memberships.map((m) => m.organizationId);

    // Batched queries by org / user. Each is a single statement.
    const [
      subscriptions,
      payments,
      couponRedemptions,
      promotionRedemptions,
      complimentaryAccess,
      entitlementOverrides,
      loginHistory,
    ] = await Promise.all([
      orgIds.length === 0
        ? Promise.resolve([] as Array<{
            id: string;
            organizationId: string;
            planCode: string;
            status: string;
            billingPeriod: string;
            currentPeriodStart: Date | null;
            currentPeriodEnd: Date | null;
            trialStart: Date | null;
            trialEnd: Date | null;
            cancelAtPeriodEnd: boolean;
            canceledAt: Date | null;
            createdAt: Date;
            organization: { name: string };
            plan: { name: string } | null;
          }>)
        : this.prisma.subscription.findMany({
            where: { organizationId: { in: orgIds } },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              organizationId: true,
              planCode: true,
              status: true,
              billingPeriod: true,
              currentPeriodStart: true,
              currentPeriodEnd: true,
              trialStart: true,
              trialEnd: true,
              cancelAtPeriodEnd: true,
              canceledAt: true,
              createdAt: true,
              organization: { select: { name: true } },
              plan: { select: { name: true } },
            },
          }),
      orgIds.length === 0
        ? Promise.resolve([] as Array<{
            id: string;
            organizationId: string;
            amount: number;
            currency: string;
            status: string;
            paymentType: string;
            paidAt: Date | null;
            providerInvoiceId: string;
          }>)
        : this.prisma.payment.findMany({
            where: { organizationId: { in: orgIds } },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              id: true,
              organizationId: true,
              amount: true,
              currency: true,
              status: true,
              paymentType: true,
              paidAt: true,
              providerInvoiceId: true,
            },
          }),
      this.prisma.couponRedemption.findMany({
        where: { userId: id },
        orderBy: { reservedAt: 'desc' },
        select: {
          id: true,
          discountAmountApplied: true,
          redeemedAt: true,
          status: true,
          coupon: { select: { code: true } },
        },
      }),
      this.prisma.promotionRedemption.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          discountAmountApplied: true,
          status: true,
          createdAt: true,
          promotion: { select: { name: true, slug: true } },
        },
      }),
      orgIds.length === 0
        ? Promise.resolve([] as Array<{
            id: string;
            organizationId: string;
            planCode: string;
            reason: string;
            startsAt: Date;
            endsAt: Date | null;
            status: string;
          }>)
        : this.prisma.complimentaryAccess.findMany({
            where: { organizationId: { in: orgIds } },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              organizationId: true,
              planCode: true,
              reason: true,
              startsAt: true,
              endsAt: true,
              status: true,
            },
          }),
      orgIds.length === 0
        ? Promise.resolve([] as Array<{
            id: string;
            organizationId: string;
            entitlementKey: string;
            overrideType: string;
            numericValue: number | null;
            booleanValue: boolean | null;
            reason: string;
            startsAt: Date;
            expiresAt: Date | null;
            isActive: boolean;
          }>)
        : this.prisma.entitlementOverride.findMany({
            where: { organizationId: { in: orgIds } },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              organizationId: true,
              entitlementKey: true,
              overrideType: true,
              numericValue: true,
              booleanValue: true,
              reason: true,
              startsAt: true,
              expiresAt: true,
              isActive: true,
            },
          }),
      // Last 20 login events for the Login Activity tab. Indexed scan via
      // idx_login_event_user_created.
      this.prisma.loginEvent.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          eventType: true,
          ipAddress: true,
          userAgent: true,
          country: true,
          region: true,
          city: true,
          failureReason: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      status: user.status,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      userRole: user.userRole,
      onboardingCompletedAt: user.onboardingCompletedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      signupSource: user.googleId ? 'google' : 'password',
      memberships: user.memberships.map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        organizationSlug: m.organization.slug,
        role: m.role,
        status: m.status,
        joinedAt: m.createdAt,
      })),
      subscriptions: subscriptions.map((s) => ({
        id: s.id,
        organizationId: s.organizationId,
        organizationName: s.organization.name,
        planCode: s.planCode,
        planName: s.plan?.name ?? null,
        status: s.status,
        billingPeriod: s.billingPeriod,
        currentPeriodStart: s.currentPeriodStart,
        currentPeriodEnd: s.currentPeriodEnd,
        trialStart: s.trialStart,
        trialEnd: s.trialEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        canceledAt: s.canceledAt,
        createdAt: s.createdAt,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        organizationId: p.organizationId,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        paymentType: p.paymentType,
        paidAt: p.paidAt,
        // Response key unchanged — admin clients read `xenditInvoiceId`.
        xenditInvoiceId: p.providerInvoiceId,
      })),
      couponRedemptions: couponRedemptions.map((c) => ({
        id: c.id,
        couponCode: c.coupon.code,
        discountAmountApplied: c.discountAmountApplied,
        redeemedAt: c.redeemedAt,
        status: c.status,
      })),
      promotionRedemptions: promotionRedemptions.map((p) => ({
        id: p.id,
        promotionName: p.promotion.name,
        promotionSlug: p.promotion.slug,
        discountAmountApplied: p.discountAmountApplied,
        status: p.status,
        createdAt: p.createdAt,
      })),
      complimentaryAccess: complimentaryAccess.map((c) => ({
        id: c.id,
        organizationId: c.organizationId,
        planCode: c.planCode,
        reason: c.reason,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        status: c.status,
      })),
      entitlementOverrides: entitlementOverrides.map((o) => ({
        id: o.id,
        organizationId: o.organizationId,
        entitlementKey: o.entitlementKey,
        overrideType: o.overrideType,
        numericValue: o.numericValue,
        booleanValue: o.booleanValue,
        reason: o.reason,
        startsAt: o.startsAt,
        expiresAt: o.expiresAt,
        isActive: o.isActive,
      })),
      expertVerification: user.expertVerification
        ? {
            expertiseType: user.expertVerification.expertiseType,
            status: user.expertVerification.status,
            reviewedAt: user.expertVerification.reviewedAt,
            createdAt: user.expertVerification.createdAt,
          }
        : null,
      emailPreferences: user.emailPreference
        ? {
            transactional: user.emailPreference.transactional,
            subscriptionUpdates: user.emailPreference.subscriptionUpdates,
            announcements: user.emailPreference.announcements,
            blogNotifications: user.emailPreference.blogNotifications,
          }
        : null,
      lastLoginAt: user.lastLoginAt,
      lastLoginCountry: user.lastLoginCountry,
      lastLoginCity: user.lastLoginCity,
      lastLoginRegion: user.lastLoginRegion,
      lastLoginIp: user.lastLoginIp,
      loginHistory: loginHistory.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        ipAddress: e.ipAddress,
        userAgent: e.userAgent,
        country: e.country,
        region: e.region,
        city: e.city,
        failureReason: e.failureReason,
        createdAt: e.createdAt,
      })),
    };
  }
}
