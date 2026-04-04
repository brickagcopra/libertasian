import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { createHash } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';

// ---- Constants ----

/** Reservation TTL in minutes */
const RESERVATION_TTL_MINUTES = 30;

/** Tier hierarchy for minimum plan tier checks */
const TIER_HIERARCHY: Record<string, number> = {
  free: 0,
  edu: 1,
  pro: 2,
  team: 3,
  enterprise: 4,
};

// ---- Types ----

export interface CouponValidationResult {
  valid: boolean;
  coupon?: CouponRecord;
  errors: string[];
  discountPreview?: DiscountPreview;
}

export interface DiscountPreview {
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  discountType: string;
  discountValue: number;
  currency: string;
}

export interface CalculateDiscountResult {
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
}

/** Shape of a Coupon row returned by Prisma */
interface CouponRecord {
  id: string;
  code: string;
  codeHash: string;
  name: string;
  description: string | null;
  internalNotes: string | null;
  discountType: string;
  discountValue: number;
  currency: string;
  appliesToBillingPeriod: string;
  maxRedemptions: number | null;
  maxRedemptionsPerOrg: number;
  currentRedemptions: number;
  startsAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
  isArchived: boolean;
  minimumPlanTier: string | null;
  bonusEntitlementKey: string | null;
  bonusEntitlementValue: number | null;
  bonusDurationDays: number | null;
  trialExtensionDays: number | null;
  metadataJson: unknown;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CouponService {
  private readonly logger = new Logger(CouponService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlementService: EntitlementService,
    @Inject(forwardRef(() => PricingEngineService))
    private readonly pricingEngine: PricingEngineService,
  ) {}

  // ====================================================================
  // Core Methods
  // ====================================================================

  /**
   * Validate a coupon code for a specific organization, user, plan, and billing period.
   * Returns a structured result with errors array and discount preview.
   */
  async validateCoupon(
    code: string,
    organizationId: string,
    userId: string,
    planCode: string,
    billingPeriod: string,
  ): Promise<CouponValidationResult> {
    const errors: string[] = [];

    // 1. Lookup by code (case-insensitive, trimmed)
    const coupon = await this.findByCode(code);
    if (!coupon) {
      return { valid: false, errors: ['Coupon code not found'] };
    }

    // 2. Check isActive and not archived
    if (!coupon.isActive) {
      errors.push('Coupon is not active');
    }
    if (coupon.isArchived) {
      errors.push('Coupon has been archived');
    }

    // 3. Check date range
    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) {
      errors.push('Coupon is not yet valid');
    }
    if (coupon.expiresAt && coupon.expiresAt <= now) {
      errors.push('Coupon has expired');
    }

    // 4. Check global redemption limit
    if (coupon.maxRedemptions !== null && coupon.currentRedemptions >= coupon.maxRedemptions) {
      errors.push('Coupon has reached its maximum redemptions');
    }

    // 5. Check per-org limit
    const orgRedemptionCount = await this.getRedemptionCount(coupon.id, organizationId);
    if (orgRedemptionCount >= coupon.maxRedemptionsPerOrg) {
      errors.push('Your organization has already used this coupon');
    }

    // 6. Check plan rules
    const planAllowed = await this.checkPlanRules(coupon.id, planCode);
    if (!planAllowed) {
      errors.push('Coupon is not valid for the selected plan');
    }

    // 7. Check billing period restriction
    if (coupon.appliesToBillingPeriod !== 'any' && coupon.appliesToBillingPeriod !== billingPeriod) {
      errors.push(`Coupon is only valid for ${coupon.appliesToBillingPeriod} billing`);
    }

    // 8. Check minimum plan tier
    if (coupon.minimumPlanTier) {
      const requiredTier = TIER_HIERARCHY[coupon.minimumPlanTier] ?? 0;
      const currentTier = TIER_HIERARCHY[planCode] ?? 0;
      if (currentTier < requiredTier) {
        errors.push(`Coupon requires ${coupon.minimumPlanTier} plan or higher`);
      }
    }

    // 9. Check user/org assignment restrictions
    const assignmentValid = await this.checkAssignments(coupon.id, organizationId, userId);
    if (!assignmentValid) {
      errors.push('Coupon is not available for your account');
    }

    // 10. Check no existing active reservation for this org+coupon
    const existingReservation = await this.prisma.couponRedemption.findFirst({
      where: {
        couponId: coupon.id,
        organizationId,
        status: 'reserved',
        expiresAt: { gt: now },
      },
    });
    if (existingReservation) {
      errors.push('An active reservation already exists for this coupon');
    }

    if (errors.length > 0) {
      return { valid: false, coupon, errors };
    }

    // 11. Calculate discount preview
    const discountResult = await this.calculateDiscount(coupon, planCode, billingPeriod);
    const discountPreview: DiscountPreview = {
      originalAmount: discountResult.originalAmount,
      discountAmount: discountResult.discountAmount,
      finalAmount: discountResult.finalAmount,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      currency: coupon.currency,
    };

    return { valid: true, coupon, errors: [], discountPreview };
  }

  /**
   * Reserve a coupon for checkout. Creates a CouponRedemption with status='reserved'.
   * Uses a transaction with row-level lock on the Coupon to prevent over-redemption.
   */
  async reserveCoupon(
    code: string,
    organizationId: string,
    userId: string,
    planCode: string,
    billingPeriod: string,
  ) {
    // Validate first
    const validation = await this.validateCoupon(code, organizationId, userId, planCode, billingPeriod);
    if (!validation.valid) {
      throw new BadRequestException(validation.errors.join('; '));
    }

    const couponId = validation.coupon!.id;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MINUTES * 60 * 1000);

    // Transaction with row-level lock on Coupon
    const redemption = await this.prisma.$transaction(async (tx) => {
      // Lock the coupon row for update
      const [locked] = await tx.$queryRawUnsafe<CouponRecord[]>(
        'SELECT * FROM "coupons" WHERE "id" = $1 FOR UPDATE',
        couponId,
      );

      if (!locked) {
        throw new NotFoundException('Coupon not found');
      }

      // Re-check global limit under lock
      if (locked.maxRedemptions !== null && locked.currentRedemptions >= locked.maxRedemptions) {
        throw new ConflictException('Coupon has reached its maximum redemptions');
      }

      // Increment currentRedemptions
      await tx.coupon.update({
        where: { id: couponId },
        data: { currentRedemptions: { increment: 1 } },
      });

      // Create reservation
      return tx.couponRedemption.create({
        data: {
          couponId,
          organizationId,
          userId,
          status: 'reserved',
          originalAmount: validation.discountPreview?.originalAmount ?? null,
          discountAmountApplied: validation.discountPreview?.discountAmount ?? null,
          reservedAt: now,
          expiresAt,
          metadataJson: {
            planCode,
            billingPeriod,
            discountType: validation.coupon!.discountType,
            discountValue: validation.coupon!.discountValue,
          },
        },
      });
    });

    await this.audit.log({
      organizationId,
      actorUserId: userId,
      actorType: 'user',
      action: 'coupon.reserved',
      entityType: 'CouponRedemption',
      entityId: redemption.id,
      metadata: {
        couponId,
        couponCode: validation.coupon!.code,
        planCode,
        billingPeriod,
        expiresAt: expiresAt.toISOString(),
      },
    });

    this.logger.log(
      `Coupon ${validation.coupon!.code} reserved for org ${organizationId} (redemption: ${redemption.id})`,
    );

    return redemption;
  }

  /**
   * Finalize a coupon reservation after successful payment.
   * Transitions: reserved → redeemed. Links subscription + payment.
   * For bonus_credit type, grants the bonus via EntitlementService.
   */
  async finalizeCoupon(
    redemptionId: string,
    subscriptionId: string,
    paymentId: string | null,
    discountAmountApplied: number,
  ) {
    const redemption = await this.prisma.couponRedemption.findUnique({
      where: { id: redemptionId },
      include: { coupon: true },
    });

    if (!redemption) {
      throw new NotFoundException(`Coupon redemption ${redemptionId} not found`);
    }

    if (redemption.status !== 'reserved') {
      throw new BadRequestException(
        `Cannot finalize redemption in status '${redemption.status}' (expected 'reserved')`,
      );
    }

    const now = new Date();

    // Update redemption to redeemed
    const updated = await this.prisma.couponRedemption.update({
      where: { id: redemptionId },
      data: {
        status: 'redeemed',
        subscriptionId,
        paymentId: paymentId ?? undefined,
        discountAmountApplied,
        redeemedAt: now,
      },
    });

    // Update user/org assignment claimedAt if applicable
    await this.markAssignmentClaimed(
      redemption.couponId,
      redemption.organizationId,
      redemption.userId,
    );

    // If bonus_credit type, grant the bonus
    const coupon = redemption.coupon;
    if (coupon.discountType === 'bonus_credit' && coupon.bonusEntitlementKey) {
      const bonusExpiresAt = coupon.bonusDurationDays
        ? new Date(now.getTime() + coupon.bonusDurationDays * 24 * 60 * 60 * 1000)
        : undefined;

      await this.entitlementService.grantBonus({
        organizationId: redemption.organizationId,
        entitlementKey: coupon.bonusEntitlementKey,
        overrideType: 'bonus_credit',
        numericValue: coupon.bonusEntitlementValue ?? undefined,
        reason: `Coupon ${coupon.code} bonus credit`,
        sourceType: 'coupon',
        sourceId: coupon.id,
        startsAt: now,
        expiresAt: bonusExpiresAt,
        createdByUserId: redemption.userId,
      });
    }

    await this.audit.log({
      organizationId: redemption.organizationId,
      actorUserId: redemption.userId,
      actorType: 'system',
      action: 'coupon.redeemed',
      entityType: 'CouponRedemption',
      entityId: redemptionId,
      metadata: {
        couponId: redemption.couponId,
        couponCode: coupon.code,
        subscriptionId,
        paymentId,
        discountAmountApplied,
        discountType: coupon.discountType,
      },
    });

    this.logger.log(
      `Coupon ${coupon.code} finalized for org ${redemption.organizationId} (redemption: ${redemptionId})`,
    );

    return updated;
  }

  /**
   * Rollback a coupon reservation on checkout failure.
   * Transitions: reserved → rolled_back. Decrements the counter.
   */
  async rollbackCoupon(redemptionId: string) {
    const redemption = await this.prisma.couponRedemption.findUnique({
      where: { id: redemptionId },
      include: { coupon: true },
    });

    if (!redemption) {
      throw new NotFoundException(`Coupon redemption ${redemptionId} not found`);
    }

    if (redemption.status !== 'reserved') {
      throw new BadRequestException(
        `Cannot rollback redemption in status '${redemption.status}' (expected 'reserved')`,
      );
    }

    const now = new Date();

    // Transaction: update redemption + decrement counter
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.couponRedemption.update({
        where: { id: redemptionId },
        data: {
          status: 'rolled_back',
          rolledBackAt: now,
        },
      });

      await tx.coupon.update({
        where: { id: redemption.couponId },
        data: { currentRedemptions: { decrement: 1 } },
      });

      return result;
    });

    await this.audit.log({
      organizationId: redemption.organizationId,
      actorUserId: redemption.userId,
      actorType: 'system',
      action: 'coupon.rolled_back',
      entityType: 'CouponRedemption',
      entityId: redemptionId,
      metadata: {
        couponId: redemption.couponId,
        couponCode: redemption.coupon.code,
      },
    });

    this.logger.log(
      `Coupon ${redemption.coupon.code} rolled back for org ${redemption.organizationId} (redemption: ${redemptionId})`,
    );

    return updated;
  }

  /**
   * Expire stale reservations. Called by BullMQ cron job every 5 minutes.
   * Finds all reserved redemptions past their expiresAt, marks them expired,
   * and decrements the coupon counters.
   */
  async expireStaleReservations(): Promise<number> {
    const now = new Date();

    const stale = await this.prisma.couponRedemption.findMany({
      where: {
        status: 'reserved',
        expiresAt: { lt: now },
      },
      include: { coupon: true },
    });

    if (stale.length === 0) {
      return 0;
    }

    // Process each expiration in a transaction
    for (const redemption of stale) {
      await this.prisma.$transaction(async (tx) => {
        await tx.couponRedemption.update({
          where: { id: redemption.id },
          data: { status: 'expired' },
        });

        await tx.coupon.update({
          where: { id: redemption.couponId },
          data: { currentRedemptions: { decrement: 1 } },
        });
      });

      await this.audit.log({
        organizationId: redemption.organizationId,
        actorType: 'system',
        action: 'coupon.reservation_expired',
        entityType: 'CouponRedemption',
        entityId: redemption.id,
        metadata: {
          couponId: redemption.couponId,
          couponCode: redemption.coupon.code,
        },
      });
    }

    this.logger.log(`Expired ${stale.length} stale coupon reservations`);
    return stale.length;
  }

  /**
   * Calculate the discount for a coupon + plan + billing period.
   * Resolves plan price via DB or hardcoded fallback.
   */
  async calculateDiscount(
    coupon: CouponRecord,
    planCode: string,
    billingPeriod: string,
  ): Promise<CalculateDiscountResult> {
    const resolved = await this.pricingEngine.resolvePlanPrice(planCode, billingPeriod);
    const originalAmount = resolved.amount;

    let discountAmount = 0;

    switch (coupon.discountType) {
      case 'percentage': {
        const pct = Math.min(Math.max(coupon.discountValue, 0), 100);
        discountAmount = Math.round((originalAmount * pct) / 100);
        break;
      }
      case 'fixed_amount': {
        discountAmount = Math.min(coupon.discountValue, originalAmount);
        break;
      }
      case 'bonus_credit':
      case 'trial_extension': {
        // These types don't reduce the payment amount
        discountAmount = 0;
        break;
      }
      default:
        discountAmount = 0;
    }

    return {
      originalAmount,
      discountAmount,
      finalAmount: originalAmount - discountAmount,
    };
  }

  // ====================================================================
  // Helper Methods
  // ====================================================================

  /**
   * Find a coupon by code (case-insensitive, trimmed).
   */
  async findByCode(code: string): Promise<CouponRecord | null> {
    const normalized = code.trim().toUpperCase();
    return this.prisma.coupon.findUnique({
      where: { code: normalized },
    }) as Promise<CouponRecord | null>;
  }

  /**
   * Get active (reserved or redeemed) redemption count for a coupon,
   * optionally scoped to an organization.
   */
  async getRedemptionCount(couponId: string, organizationId?: string): Promise<number> {
    return this.prisma.couponRedemption.count({
      where: {
        couponId,
        ...(organizationId && { organizationId }),
        status: { in: ['reserved', 'redeemed'] },
      },
    });
  }

  /**
   * Check if a plan is allowed by the coupon's plan rules.
   * If no rules exist, all plans are allowed.
   * If include rules exist, plan must be in the include list.
   * If exclude rules exist, plan must not be in the exclude list.
   */
  async checkPlanRules(couponId: string, planCode: string): Promise<boolean> {
    const rules = await this.prisma.couponPlanRule.findMany({
      where: { couponId },
    });

    if (rules.length === 0) {
      return true; // No rules = all plans allowed
    }

    const includeRules = rules.filter((r) => r.ruleType === 'include');
    const excludeRules = rules.filter((r) => r.ruleType === 'exclude');

    // If there are include rules, the plan must be in the include list
    if (includeRules.length > 0) {
      return includeRules.some((r) => r.planCode === planCode);
    }

    // If there are only exclude rules, the plan must not be in the exclude list
    if (excludeRules.length > 0) {
      return !excludeRules.some((r) => r.planCode === planCode);
    }

    return true;
  }

  /**
   * Check if a coupon has pre-assignments and whether the user/org is in the list.
   * If the coupon has no assignments at all, anyone can use it (returns true).
   * If it has user assignments, the user must be in the list.
   * If it has org assignments, the org must be in the list.
   */
  async checkAssignments(
    couponId: string,
    organizationId: string,
    userId: string,
  ): Promise<boolean> {
    const [userAssignments, orgAssignments] = await Promise.all([
      this.prisma.couponUserAssignment.findMany({ where: { couponId } }),
      this.prisma.couponOrgAssignment.findMany({ where: { couponId } }),
    ]);

    // No assignments = public coupon, anyone can use
    if (userAssignments.length === 0 && orgAssignments.length === 0) {
      return true;
    }

    // Check user assignment
    if (userAssignments.length > 0) {
      const userMatch = userAssignments.some((a) => a.userId === userId);
      if (userMatch) return true;
    }

    // Check org assignment
    if (orgAssignments.length > 0) {
      const orgMatch = orgAssignments.some((a) => a.organizationId === organizationId);
      if (orgMatch) return true;
    }

    // Has assignments but neither user nor org matched
    return false;
  }

  /**
   * Hash a coupon code using SHA-256 for consistent lookups.
   */
  static hashCode(code: string): string {
    return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
  }

  // ====================================================================
  // Admin CRUD Methods
  // ====================================================================

  /**
   * Create a new coupon.
   */
  async create(
    data: {
      code: string;
      name: string;
      description?: string;
      internalNotes?: string;
      discountType: string;
      discountValue: number;
      currency?: string;
      appliesToBillingPeriod?: string;
      maxRedemptions?: number;
      maxRedemptionsPerOrg?: number;
      startsAt?: string;
      expiresAt?: string;
      minimumPlanTier?: string;
      bonusEntitlementKey?: string;
      bonusEntitlementValue?: number;
      bonusDurationDays?: number;
      trialExtensionDays?: number;
      isActive?: boolean;
      metadataJson?: Record<string, unknown>;
    },
    createdByUserId: string,
  ) {
    const normalizedCode = data.code.trim().toUpperCase();
    const codeHash = CouponService.hashCode(normalizedCode);

    // Check for duplicate code
    const existing = await this.prisma.coupon.findUnique({ where: { code: normalizedCode } });
    if (existing) {
      throw new ConflictException(`Coupon code '${normalizedCode}' already exists`);
    }

    const coupon = await this.prisma.coupon.create({
      data: {
        code: normalizedCode,
        codeHash,
        name: data.name,
        description: data.description ?? null,
        internalNotes: data.internalNotes ?? null,
        discountType: data.discountType,
        discountValue: data.discountValue,
        currency: data.currency ?? 'PHP',
        appliesToBillingPeriod: data.appliesToBillingPeriod ?? 'any',
        maxRedemptions: data.maxRedemptions ?? null,
        maxRedemptionsPerOrg: data.maxRedemptionsPerOrg ?? 1,
        startsAt: data.startsAt ? new Date(data.startsAt) : null,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        minimumPlanTier: data.minimumPlanTier ?? null,
        bonusEntitlementKey: data.bonusEntitlementKey ?? null,
        bonusEntitlementValue: data.bonusEntitlementValue ?? null,
        bonusDurationDays: data.bonusDurationDays ?? null,
        trialExtensionDays: data.trialExtensionDays ?? null,
        isActive: data.isActive ?? true,
        metadataJson: (data.metadataJson ?? {}) as Record<string, string>,
        createdByUserId,
      },
    });

    this.logger.log(`Coupon created: ${normalizedCode} (${coupon.id})`);
    return coupon;
  }

  /**
   * Update an existing coupon. Cannot change code or discountType.
   */
  async update(
    id: string,
    data: {
      name?: string;
      description?: string;
      internalNotes?: string;
      appliesToBillingPeriod?: string;
      maxRedemptions?: number;
      maxRedemptionsPerOrg?: number;
      startsAt?: string;
      expiresAt?: string;
      minimumPlanTier?: string;
      bonusEntitlementKey?: string;
      bonusEntitlementValue?: number;
      bonusDurationDays?: number;
      trialExtensionDays?: number;
      isActive?: boolean;
      metadataJson?: Record<string, unknown>;
    },
  ) {
    const existing = await this.prisma.coupon.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Coupon ${id} not found`);
    }

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData['name'] = data.name;
    if (data.description !== undefined) updateData['description'] = data.description;
    if (data.internalNotes !== undefined) updateData['internalNotes'] = data.internalNotes;
    if (data.appliesToBillingPeriod !== undefined) updateData['appliesToBillingPeriod'] = data.appliesToBillingPeriod;
    if (data.maxRedemptions !== undefined) updateData['maxRedemptions'] = data.maxRedemptions;
    if (data.maxRedemptionsPerOrg !== undefined) updateData['maxRedemptionsPerOrg'] = data.maxRedemptionsPerOrg;
    if (data.startsAt !== undefined) updateData['startsAt'] = new Date(data.startsAt);
    if (data.expiresAt !== undefined) updateData['expiresAt'] = new Date(data.expiresAt);
    if (data.minimumPlanTier !== undefined) updateData['minimumPlanTier'] = data.minimumPlanTier;
    if (data.bonusEntitlementKey !== undefined) updateData['bonusEntitlementKey'] = data.bonusEntitlementKey;
    if (data.bonusEntitlementValue !== undefined) updateData['bonusEntitlementValue'] = data.bonusEntitlementValue;
    if (data.bonusDurationDays !== undefined) updateData['bonusDurationDays'] = data.bonusDurationDays;
    if (data.trialExtensionDays !== undefined) updateData['trialExtensionDays'] = data.trialExtensionDays;
    if (data.isActive !== undefined) updateData['isActive'] = data.isActive;
    if (data.metadataJson !== undefined) updateData['metadataJson'] = data.metadataJson;

    return this.prisma.coupon.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * Get a coupon by ID with plan rules, assignment counts, and redemption stats.
   */
  async findById(id: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { id },
      include: {
        planRules: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        _count: {
          select: {
            redemptions: true,
            userAssignments: true,
            orgAssignments: true,
          },
        },
      },
    });

    if (!coupon) {
      throw new NotFoundException(`Coupon ${id} not found`);
    }

    // Get redemption stats
    const [redeemedCount, reservedCount] = await Promise.all([
      this.prisma.couponRedemption.count({ where: { couponId: id, status: 'redeemed' } }),
      this.prisma.couponRedemption.count({ where: { couponId: id, status: 'reserved' } }),
    ]);

    return {
      ...coupon,
      stats: {
        totalRedemptions: coupon._count.redemptions,
        redeemedCount,
        reservedCount,
        userAssignments: coupon._count.userAssignments,
        orgAssignments: coupon._count.orgAssignments,
      },
    };
  }

  /**
   * List coupons with pagination, search, and filters.
   */
  async list(params: {
    cursor?: string;
    limit?: number;
    search?: string;
    discountType?: string;
    isActive?: boolean;
    isArchived?: boolean;
    sortBy?: string;
    sortDir?: string;
  }) {
    const limit = params.limit ?? 20;
    const sortBy = params.sortBy ?? 'createdAt';
    const sortDir = (params.sortDir ?? 'desc') as 'asc' | 'desc';

    const where: Record<string, unknown> = {};

    if (params.search) {
      where['OR'] = [
        { code: { contains: params.search.toUpperCase(), mode: 'insensitive' } },
        { name: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    if (params.discountType !== undefined) {
      where['discountType'] = params.discountType;
    }

    if (params.isActive !== undefined) {
      where['isActive'] = params.isActive;
    }

    if (params.isArchived !== undefined) {
      where['isArchived'] = params.isArchived;
    }

    const coupons = await this.prisma.coupon.findMany({
      take: limit + 1,
      ...(params.cursor && { skip: 1, cursor: { id: params.cursor } }),
      where,
      orderBy: { [sortBy]: sortDir },
      include: {
        _count: { select: { redemptions: true } },
      },
    });

    const hasNext = coupons.length > limit;
    const data = hasNext ? coupons.slice(0, limit) : coupons;
    const nextCursor = hasNext && data.length > 0 ? data[data.length - 1]!.id : undefined;

    return { data, nextCursor, hasNext };
  }

  /**
   * Archive a coupon (soft delete). Archived coupons cannot be used.
   */
  async archive(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) {
      throw new NotFoundException(`Coupon ${id} not found`);
    }
    if (coupon.isArchived) {
      throw new BadRequestException('Coupon is already archived');
    }

    return this.prisma.coupon.update({
      where: { id },
      data: { isArchived: true, isActive: false },
    });
  }

  /**
   * Toggle active status for a coupon.
   */
  async toggleActive(id: string, isActive: boolean) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) {
      throw new NotFoundException(`Coupon ${id} not found`);
    }
    if (coupon.isArchived) {
      throw new BadRequestException('Cannot activate an archived coupon');
    }

    return this.prisma.coupon.update({
      where: { id },
      data: { isActive },
    });
  }

  /**
   * Get redemption history for a specific coupon (paginated).
   */
  async getRedemptionHistory(
    couponId: string,
    params: { cursor?: string; limit?: number; status?: string; organizationId?: string },
  ) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) {
      throw new NotFoundException(`Coupon ${couponId} not found`);
    }

    const limit = params.limit ?? 20;
    const where: Record<string, unknown> = { couponId };

    if (params.status) {
      where['status'] = params.status;
    }
    if (params.organizationId) {
      where['organizationId'] = params.organizationId;
    }

    const redemptions = await this.prisma.couponRedemption.findMany({
      take: limit + 1,
      ...(params.cursor && { skip: 1, cursor: { id: params.cursor } }),
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    const hasNext = redemptions.length > limit;
    const data = hasNext ? redemptions.slice(0, limit) : redemptions;
    const nextCursor = hasNext && data.length > 0 ? data[data.length - 1]!.id : undefined;

    return { data, nextCursor, hasNext };
  }

  /**
   * Assign coupon to specific users (pre-assignment).
   */
  async assignUsers(couponId: string, userIds: string[]) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) {
      throw new NotFoundException(`Coupon ${couponId} not found`);
    }

    const assignments = await this.prisma.$transaction(
      userIds.map((userId) =>
        this.prisma.couponUserAssignment.upsert({
          where: { couponId_userId: { couponId, userId } },
          create: { couponId, userId },
          update: {}, // no-op if already exists
        }),
      ),
    );

    return { count: assignments.length };
  }

  /**
   * Assign coupon to specific organizations (pre-assignment).
   */
  async assignOrgs(couponId: string, organizationIds: string[]) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) {
      throw new NotFoundException(`Coupon ${couponId} not found`);
    }

    const assignments = await this.prisma.$transaction(
      organizationIds.map((organizationId) =>
        this.prisma.couponOrgAssignment.upsert({
          where: { couponId_organizationId: { couponId, organizationId } },
          create: { couponId, organizationId },
          update: {}, // no-op if already exists
        }),
      ),
    );

    return { count: assignments.length };
  }

  /**
   * Replace all plan rules for a coupon with the provided set.
   */
  async setPlanRules(couponId: string, rules: Array<{ planCode: string; ruleType: string }>) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) {
      throw new NotFoundException(`Coupon ${couponId} not found`);
    }

    // Delete existing rules, then create new ones
    await this.prisma.$transaction([
      this.prisma.couponPlanRule.deleteMany({ where: { couponId } }),
      ...rules.map((rule) =>
        this.prisma.couponPlanRule.create({
          data: { couponId, planCode: rule.planCode, ruleType: rule.ruleType },
        }),
      ),
    ]);

    // Return the new rules
    return this.prisma.couponPlanRule.findMany({ where: { couponId } });
  }

  // ---- Private Helpers ----

  /**
   * Mark user/org assignment as claimed if applicable.
   */
  private async markAssignmentClaimed(
    couponId: string,
    organizationId: string,
    userId: string,
  ): Promise<void> {
    const now = new Date();

    // Update user assignment
    await this.prisma.couponUserAssignment.updateMany({
      where: { couponId, userId, claimedAt: null },
      data: { claimedAt: now },
    });

    // Update org assignment
    await this.prisma.couponOrgAssignment.updateMany({
      where: { couponId, organizationId, claimedAt: null },
      data: { claimedAt: now },
    });
  }
}
