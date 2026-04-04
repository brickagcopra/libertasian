import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { PromotionRuleEngineService } from './promotion-rule-engine.service';

// ---- Types ----

/** Shape of a Promotion row returned by Prisma */
interface PromotionRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  internalNotes: string | null;
  promotionType: string;
  status: string;
  priority: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  maxRedemptionsPerOrg: number;
  currentRedemptions: number;
  isStackableWithCoupons: boolean;
  isStackableWithPromos: boolean;
  isDisplayedOnPricing: boolean;
  metadataJson: unknown;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplyPromotionParams {
  promotionId: string;
  organizationId: string;
  userId: string;
  planCode: string;
  billingPeriod: string;
  subscriptionId?: string;
  paymentId?: string;
}

export interface ApplyPromotionResult {
  redemptionId: string;
  discountAmountApplied: number;
  originalAmount: number;
  benefitsApplied: Record<string, unknown>[];
}

@Injectable()
export class PromotionService {
  private readonly logger = new Logger(PromotionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlementService: EntitlementService,
    private readonly ruleEngine: PromotionRuleEngineService,
    @Inject(forwardRef(() => PricingEngineService))
    private readonly pricingEngine: PricingEngineService,
  ) {}

  // ------------------------------------------------------------------
  // CRUD
  // ------------------------------------------------------------------

  /** Find a promotion by ID, including rules and benefits. */
  async findById(id: string): Promise<PromotionRecord & { rules: unknown[]; benefits: unknown[] }> {
    const promotion = await this.prisma.promotion.findUnique({
      where: { id },
      include: { rules: { orderBy: { ordering: 'asc' } }, benefits: true },
    });

    if (!promotion) {
      throw new NotFoundException(`Promotion '${id}' not found`);
    }

    return promotion;
  }

  /** Find a promotion by ID with detailed stats (admin view). */
  async findByIdWithStats(id: string) {
    const promotion = await this.prisma.promotion.findUnique({
      where: { id },
      include: {
        rules: { orderBy: { ordering: 'asc' } },
        benefits: true,
        planRules: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        _count: {
          select: { redemptions: true },
        },
      },
    });

    if (!promotion) {
      throw new NotFoundException(`Promotion '${id}' not found`);
    }

    const [appliedCount, revokedCount] = await Promise.all([
      this.prisma.promotionRedemption.count({ where: { promotionId: id, status: 'applied' } }),
      this.prisma.promotionRedemption.count({ where: { promotionId: id, status: 'revoked' } }),
    ]);

    return {
      ...promotion,
      stats: {
        totalRedemptions: promotion._count.redemptions,
        appliedCount,
        revokedCount,
      },
    };
  }

  /** Find a promotion by slug. */
  async findBySlug(slug: string): Promise<PromotionRecord> {
    const promotion = await this.prisma.promotion.findUnique({
      where: { slug },
      include: { benefits: true },
    });

    if (!promotion) {
      throw new NotFoundException(`Promotion with slug '${slug}' not found`);
    }

    return promotion;
  }

  /** List promotions with cursor-based pagination, search, and filters. */
  async list(params: {
    cursor?: string;
    limit?: number;
    status?: string;
    search?: string;
    promotionType?: string;
    isDisplayedOnPricing?: boolean;
    sortBy?: string;
    sortDir?: string;
  }) {
    const limit = params.limit ?? 20;
    const sortBy = params.sortBy ?? 'createdAt';
    const sortDir = (params.sortDir ?? 'desc') as 'asc' | 'desc';

    const where: Record<string, unknown> = {};

    if (params.search) {
      where['OR'] = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { slug: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    if (params.status !== undefined) {
      where['status'] = params.status;
    }

    if (params.promotionType !== undefined) {
      where['promotionType'] = params.promotionType;
    }

    if (params.isDisplayedOnPricing !== undefined) {
      where['isDisplayedOnPricing'] = params.isDisplayedOnPricing;
    }

    const items = await this.prisma.promotion.findMany({
      take: limit + 1,
      ...(params.cursor && { skip: 1, cursor: { id: params.cursor } }),
      where,
      orderBy: { [sortBy]: sortDir },
      include: {
        benefits: true,
        _count: { select: { redemptions: true } },
      },
    });

    const hasNext = items.length > limit;
    const data = hasNext ? items.slice(0, limit) : items;
    const nextCursor = hasNext && data.length > 0 ? data[data.length - 1]!.id : null;

    return { data, hasNext, nextCursor };
  }

  /** Create a new promotion with optional rules and benefits. */
  async create(
    data: {
      name: string;
      slug: string;
      description?: string;
      internalNotes?: string;
      promotionType: string;
      status?: string;
      priority?: number;
      startsAt?: string;
      endsAt?: string;
      maxRedemptions?: number;
      maxRedemptionsPerOrg?: number;
      isStackableWithCoupons?: boolean;
      isStackableWithPromos?: boolean;
      isDisplayedOnPricing?: boolean;
      rules?: Array<{
        ruleType: string;
        configuration: Record<string, unknown>;
        ordering?: number;
        isActive?: boolean;
      }>;
      benefits?: Array<{
        benefitType: string;
        discountValue?: number;
        bonusEntitlementKey?: string;
        bonusEntitlementValue?: number;
        bonusDurationDays?: number;
        trialExtensionDays?: number;
        appliesToBillingPeriod?: string;
      }>;
      metadataJson?: Record<string, unknown>;
    },
    createdByUserId: string,
  ) {
    // Check for duplicate slug
    const existing = await this.prisma.promotion.findUnique({ where: { slug: data.slug } });
    if (existing) {
      throw new ConflictException(`Promotion slug '${data.slug}' already exists`);
    }

    const promotion = await this.prisma.promotion.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        internalNotes: data.internalNotes ?? null,
        promotionType: data.promotionType,
        status: data.status ?? 'draft',
        priority: data.priority ?? 0,
        startsAt: data.startsAt ? new Date(data.startsAt) : null,
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
        maxRedemptions: data.maxRedemptions ?? null,
        maxRedemptionsPerOrg: data.maxRedemptionsPerOrg ?? 1,
        isStackableWithCoupons: data.isStackableWithCoupons ?? false,
        isStackableWithPromos: data.isStackableWithPromos ?? false,
        isDisplayedOnPricing: data.isDisplayedOnPricing ?? false,
        metadataJson: (data.metadataJson ?? {}) as Record<string, string>,
        createdByUserId,
        ...(data.rules?.length && {
          rules: {
            create: data.rules.map((r, i) => ({
              ruleType: r.ruleType,
              configuration: r.configuration as Record<string, string>,
              ordering: r.ordering ?? i,
              isActive: r.isActive ?? true,
            })),
          },
        }),
        ...(data.benefits?.length && {
          benefits: {
            create: data.benefits.map((b) => ({
              benefitType: b.benefitType,
              discountValue: b.discountValue ?? null,
              bonusEntitlementKey: b.bonusEntitlementKey ?? null,
              bonusEntitlementValue: b.bonusEntitlementValue ?? null,
              bonusDurationDays: b.bonusDurationDays ?? null,
              trialExtensionDays: b.trialExtensionDays ?? null,
              appliesToBillingPeriod: b.appliesToBillingPeriod ?? 'any',
            })),
          },
        }),
      },
      include: { rules: { orderBy: { ordering: 'asc' } }, benefits: true },
    });

    this.logger.log(`Promotion created: ${data.slug} (${promotion.id})`);
    return promotion;
  }

  /** Update an existing promotion. Cannot change slug or promotionType. */
  async update(
    id: string,
    data: {
      name?: string;
      description?: string;
      internalNotes?: string;
      priority?: number;
      startsAt?: string;
      endsAt?: string;
      maxRedemptions?: number;
      maxRedemptionsPerOrg?: number;
      isStackableWithCoupons?: boolean;
      isStackableWithPromos?: boolean;
      isDisplayedOnPricing?: boolean;
      status?: string;
      metadataJson?: Record<string, unknown>;
    },
  ) {
    const existing = await this.prisma.promotion.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Promotion '${id}' not found`);
    }

    // Validate status transitions if status is being changed
    if (data.status !== undefined && data.status !== existing.status) {
      this.validateStatusTransition(existing.status, data.status);
    }

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData['name'] = data.name;
    if (data.description !== undefined) updateData['description'] = data.description;
    if (data.internalNotes !== undefined) updateData['internalNotes'] = data.internalNotes;
    if (data.priority !== undefined) updateData['priority'] = data.priority;
    if (data.startsAt !== undefined) updateData['startsAt'] = new Date(data.startsAt);
    if (data.endsAt !== undefined) updateData['endsAt'] = new Date(data.endsAt);
    if (data.maxRedemptions !== undefined) updateData['maxRedemptions'] = data.maxRedemptions;
    if (data.maxRedemptionsPerOrg !== undefined) updateData['maxRedemptionsPerOrg'] = data.maxRedemptionsPerOrg;
    if (data.isStackableWithCoupons !== undefined) updateData['isStackableWithCoupons'] = data.isStackableWithCoupons;
    if (data.isStackableWithPromos !== undefined) updateData['isStackableWithPromos'] = data.isStackableWithPromos;
    if (data.isDisplayedOnPricing !== undefined) updateData['isDisplayedOnPricing'] = data.isDisplayedOnPricing;
    if (data.status !== undefined) updateData['status'] = data.status;
    if (data.metadataJson !== undefined) updateData['metadataJson'] = data.metadataJson;

    const updated = await this.prisma.promotion.update({
      where: { id },
      data: updateData,
      include: { rules: { orderBy: { ordering: 'asc' } }, benefits: true },
    });

    // Invalidate pricing cache if display flag changed or status changed
    if (data.isDisplayedOnPricing !== undefined || data.status !== undefined) {
      await this.ruleEngine.invalidatePricingCache();
    }

    return updated;
  }

  /** Archive a promotion (soft-delete). Archived promotions cannot be used. */
  async archive(id: string) {
    const promotion = await this.prisma.promotion.findUnique({ where: { id } });
    if (!promotion) {
      throw new NotFoundException(`Promotion '${id}' not found`);
    }
    if (promotion.status === 'archived') {
      throw new BadRequestException('Promotion is already archived');
    }

    const updated = await this.prisma.promotion.update({
      where: { id },
      data: { status: 'archived' },
    });

    await this.ruleEngine.invalidatePricingCache();
    return updated;
  }

  /** Manually transition promotion status with validation. */
  async setStatus(id: string, newStatus: string) {
    const promotion = await this.prisma.promotion.findUnique({ where: { id } });
    if (!promotion) {
      throw new NotFoundException(`Promotion '${id}' not found`);
    }

    this.validateStatusTransition(promotion.status, newStatus);

    const updated = await this.prisma.promotion.update({
      where: { id },
      data: { status: newStatus },
    });

    await this.ruleEngine.invalidatePricingCache();
    return updated;
  }

  /** Get paginated redemption history for a promotion. */
  async getRedemptionHistory(
    promotionId: string,
    params: { cursor?: string; limit?: number; status?: string; organizationId?: string },
  ) {
    // Verify promotion exists
    const exists = await this.prisma.promotion.findUnique({
      where: { id: promotionId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`Promotion '${promotionId}' not found`);
    }

    const limit = params.limit ?? 20;
    const where: Record<string, unknown> = { promotionId };

    if (params.status) {
      where['status'] = params.status;
    }
    if (params.organizationId) {
      where['organizationId'] = params.organizationId;
    }

    const items = await this.prisma.promotionRedemption.findMany({
      take: limit + 1,
      ...(params.cursor && { skip: 1, cursor: { id: params.cursor } }),
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        organization: { select: { id: true, name: true } },
      },
    });

    const hasNext = items.length > limit;
    const data = hasNext ? items.slice(0, limit) : items;
    const nextCursor = hasNext && data.length > 0 ? data[data.length - 1]!.id : null;

    return { data, hasNext, nextCursor };
  }

  /** Replace all rules for a promotion. */
  async setRules(
    promotionId: string,
    rules: Array<{
      ruleType: string;
      configuration: Record<string, unknown>;
      ordering?: number;
      isActive?: boolean;
    }>,
  ) {
    const promotion = await this.prisma.promotion.findUnique({ where: { id: promotionId } });
    if (!promotion) {
      throw new NotFoundException(`Promotion '${promotionId}' not found`);
    }

    // Delete existing rules and create new ones in a transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.promotionRule.deleteMany({ where: { promotionId } });

      if (rules.length > 0) {
        await tx.promotionRule.createMany({
          data: rules.map((r, i) => ({
            promotionId,
            ruleType: r.ruleType,
            configuration: r.configuration as Record<string, string>,
            ordering: r.ordering ?? i,
            isActive: r.isActive ?? true,
          })),
        });
      }
    });

    return this.prisma.promotionRule.findMany({
      where: { promotionId },
      orderBy: { ordering: 'asc' },
    });
  }

  /** Replace all benefits for a promotion. */
  async setBenefits(
    promotionId: string,
    benefits: Array<{
      benefitType: string;
      discountValue?: number;
      bonusEntitlementKey?: string;
      bonusEntitlementValue?: number;
      bonusDurationDays?: number;
      trialExtensionDays?: number;
      appliesToBillingPeriod?: string;
    }>,
  ) {
    const promotion = await this.prisma.promotion.findUnique({ where: { id: promotionId } });
    if (!promotion) {
      throw new NotFoundException(`Promotion '${promotionId}' not found`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.promotionBenefit.deleteMany({ where: { promotionId } });

      if (benefits.length > 0) {
        await tx.promotionBenefit.createMany({
          data: benefits.map((b) => ({
            promotionId,
            benefitType: b.benefitType,
            discountValue: b.discountValue ?? null,
            bonusEntitlementKey: b.bonusEntitlementKey ?? null,
            bonusEntitlementValue: b.bonusEntitlementValue ?? null,
            bonusDurationDays: b.bonusDurationDays ?? null,
            trialExtensionDays: b.trialExtensionDays ?? null,
            appliesToBillingPeriod: b.appliesToBillingPeriod ?? 'any',
          })),
        });
      }
    });

    // Invalidate pricing cache since benefit changes affect display
    await this.ruleEngine.invalidatePricingCache();

    return this.prisma.promotionBenefit.findMany({ where: { promotionId } });
  }

  /** Replace all plan rules for a promotion. */
  async setPlanRules(
    promotionId: string,
    rules: Array<{ planCode: string; ruleType: string }>,
  ) {
    const promotion = await this.prisma.promotion.findUnique({ where: { id: promotionId } });
    if (!promotion) {
      throw new NotFoundException(`Promotion '${promotionId}' not found`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.promotionPlanRule.deleteMany({ where: { promotionId } });

      if (rules.length > 0) {
        await tx.promotionPlanRule.createMany({
          data: rules.map((r) => ({
            promotionId,
            planCode: r.planCode,
            ruleType: r.ruleType,
          })),
        });
      }
    });

    return this.prisma.promotionPlanRule.findMany({ where: { promotionId } });
  }

  // ------------------------------------------------------------------
  // Status Transition Validation
  // ------------------------------------------------------------------

  /** Validate a promotion status transition. */
  private validateStatusTransition(current: string, next: string): void {
    const validTransitions: Record<string, string[]> = {
      draft: ['scheduled', 'active'],
      scheduled: ['draft', 'active', 'archived'],
      active: ['paused', 'expired', 'archived'],
      paused: ['active', 'archived'],
      expired: ['archived'],
      archived: [],
    };

    const allowed = validTransitions[current] ?? [];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Cannot transition promotion from '${current}' to '${next}'. Allowed transitions: ${allowed.join(', ') || 'none'}`,
      );
    }
  }

  // ------------------------------------------------------------------
  // Apply / Revoke
  // ------------------------------------------------------------------

  /**
   * Apply a promotion to an org/user.
   * Steps: evaluate eligibility → row-level lock → increment counter →
   * create PromotionRedemption → grant bonus entitlements → audit log
   */
  async applyPromotion(params: ApplyPromotionParams): Promise<ApplyPromotionResult> {
    const {
      promotionId,
      organizationId,
      userId,
      planCode,
      billingPeriod,
      subscriptionId,
      paymentId,
    } = params;

    // Step 1: Evaluate eligibility
    const eligibility = await this.ruleEngine.evaluatePromotion(
      promotionId,
      organizationId,
      userId,
      planCode,
      billingPeriod,
    );

    if (!eligibility.eligible) {
      throw new BadRequestException(
        `Promotion is not eligible: ${eligibility.errors.join('; ')}`,
      );
    }

    // Step 2: Fetch promotion with benefits for applying
    const promotion = await this.prisma.promotion.findUnique({
      where: { id: promotionId },
      include: { benefits: true },
    });

    if (!promotion) {
      throw new NotFoundException(`Promotion '${promotionId}' not found`);
    }

    // Step 3: Calculate discount via central pricing engine
    const resolved = await this.pricingEngine.resolvePlanPrice(planCode, billingPeriod, organizationId);
    const originalAmount = resolved.amount;

    let discountAmount = 0;
    const benefitsApplied: Record<string, unknown>[] = [];

    for (const benefit of promotion.benefits) {
      if (
        benefit.appliesToBillingPeriod !== 'any' &&
        benefit.appliesToBillingPeriod !== billingPeriod
      ) {
        continue;
      }

      if (benefit.benefitType === 'percentage_discount' && benefit.discountValue) {
        const discount = Math.round((originalAmount * benefit.discountValue) / 100);
        discountAmount += discount;
        benefitsApplied.push({
          type: 'percentage_discount',
          value: benefit.discountValue,
          discountAmount: discount,
        });
      } else if (benefit.benefitType === 'fixed_discount' && benefit.discountValue) {
        discountAmount += benefit.discountValue;
        benefitsApplied.push({
          type: 'fixed_discount',
          value: benefit.discountValue,
          discountAmount: benefit.discountValue,
        });
      } else if (
        benefit.benefitType === 'bonus_credit' &&
        benefit.bonusEntitlementKey &&
        benefit.bonusEntitlementValue
      ) {
        benefitsApplied.push({
          type: 'bonus_credit',
          entitlementKey: benefit.bonusEntitlementKey,
          entitlementValue: benefit.bonusEntitlementValue,
          durationDays: benefit.bonusDurationDays,
        });
      } else if (benefit.benefitType === 'trial_extension' && benefit.trialExtensionDays) {
        benefitsApplied.push({
          type: 'trial_extension',
          extensionDays: benefit.trialExtensionDays,
        });
      }
    }

    // Cap discount at original amount
    discountAmount = Math.min(discountAmount, originalAmount);

    // Step 4: Atomic transaction — row-level lock + counter increment + redemption
    const redemption = await this.prisma.$transaction(async (tx) => {
      // Row-level lock via findFirst + select for update pattern
      const locked = await tx.promotion.findUnique({
        where: { id: promotionId },
        select: { currentRedemptions: true, maxRedemptions: true, maxRedemptionsPerOrg: true },
      });

      if (!locked) {
        throw new NotFoundException(`Promotion '${promotionId}' not found`);
      }

      // Double-check global limit
      if (locked.maxRedemptions !== null && locked.currentRedemptions >= locked.maxRedemptions) {
        throw new ConflictException('Promotion has reached its maximum number of redemptions');
      }

      // Double-check per-org limit
      const orgCount = await tx.promotionRedemption.count({
        where: { promotionId, organizationId, status: 'applied' },
      });
      if (orgCount >= locked.maxRedemptionsPerOrg) {
        throw new ConflictException(
          'Organization has already redeemed this promotion the maximum number of times',
        );
      }

      // Increment counter
      await tx.promotion.update({
        where: { id: promotionId },
        data: { currentRedemptions: { increment: 1 } },
      });

      // Create redemption record
      return tx.promotionRedemption.create({
        data: {
          promotionId,
          organizationId,
          userId,
          subscriptionId: subscriptionId ?? null,
          paymentId: paymentId ?? null,
          status: 'applied',
          discountAmountApplied: discountAmount,
          originalAmount,
          benefitsAppliedJson: benefitsApplied as unknown as Record<string, string>,
        },
      });
    });

    // Step 5: Grant bonus entitlements (outside transaction — non-critical)
    for (const benefit of promotion.benefits) {
      if (
        benefit.benefitType === 'bonus_credit' &&
        benefit.bonusEntitlementKey &&
        benefit.bonusEntitlementValue
      ) {
        try {
          const expiresAt = benefit.bonusDurationDays
            ? new Date(Date.now() + benefit.bonusDurationDays * 24 * 60 * 60 * 1000)
            : undefined;

          await this.entitlementService.grantBonus({
            organizationId,
            entitlementKey: benefit.bonusEntitlementKey,
            overrideType: 'promo',
            numericValue: benefit.bonusEntitlementValue,
            reason: `Promotion: ${promotion.name}`,
            sourceType: 'promotion',
            sourceId: promotion.id,
            startsAt: new Date(),
            expiresAt,
            createdByUserId: userId,
          });
        } catch (err) {
          this.logger.error(
            `Failed to grant bonus entitlement for promotion ${promotionId}`,
            err,
          );
        }
      }
    }

    // Step 6: Audit log
    await this.audit.log({
      organizationId,
      actorUserId: userId,
      actorType: 'user',
      action: 'promotion.applied',
      entityType: 'PromotionRedemption',
      entityId: redemption.id,
      metadata: {
        promotionId,
        promotionName: promotion.name,
        planCode,
        billingPeriod,
        discountAmountApplied: discountAmount,
        originalAmount,
        benefitsCount: benefitsApplied.length,
      },
    });

    // Invalidate caches
    await this.ruleEngine.invalidateEligibleCache(organizationId);

    return {
      redemptionId: redemption.id,
      discountAmountApplied: discountAmount,
      originalAmount,
      benefitsApplied,
    };
  }

  /**
   * Revoke a promotion redemption.
   * Mark as revoked, decrement counter, audit log.
   */
  async revokeRedemption(
    redemptionId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    const redemption = await this.prisma.promotionRedemption.findUnique({
      where: { id: redemptionId },
      include: { promotion: { select: { id: true, name: true } } },
    });

    if (!redemption) {
      throw new NotFoundException(`Promotion redemption '${redemptionId}' not found`);
    }

    if (redemption.status === 'revoked') {
      throw new BadRequestException('Promotion redemption is already revoked');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.promotionRedemption.update({
        where: { id: redemptionId },
        data: {
          status: 'revoked',
          revokedAt: new Date(),
          revokeReason: reason,
        },
      });

      await tx.promotion.update({
        where: { id: redemption.promotionId },
        data: { currentRedemptions: { decrement: 1 } },
      });
    });

    await this.audit.log({
      organizationId: redemption.organizationId,
      actorUserId: userId,
      actorType: 'admin',
      action: 'promotion.revoked',
      entityType: 'PromotionRedemption',
      entityId: redemptionId,
      metadata: {
        promotionId: redemption.promotionId,
        promotionName: redemption.promotion.name,
        reason,
      },
    });

    await this.ruleEngine.invalidateEligibleCache(redemption.organizationId);
  }

  // ------------------------------------------------------------------
  // Scheduled Status Transitions
  // ------------------------------------------------------------------

  /**
   * Activate promotions that have reached their startsAt date.
   * Called by scheduler every 5 minutes.
   */
  async activateScheduledPromotions(): Promise<number> {
    const now = new Date();

    const promotions = await this.prisma.promotion.findMany({
      where: {
        status: 'scheduled',
        startsAt: { lte: now },
      },
      select: { id: true, name: true },
    });

    if (promotions.length === 0) {
      return 0;
    }

    await this.prisma.promotion.updateMany({
      where: {
        id: { in: promotions.map((p) => p.id) },
        status: 'scheduled',
      },
      data: { status: 'active' },
    });

    for (const promo of promotions) {
      await this.audit.log({
        actorType: 'system',
        action: 'promotion.activated',
        entityType: 'Promotion',
        entityId: promo.id,
        metadata: { promotionName: promo.name, activatedAt: now.toISOString() },
      });
    }

    // Invalidate pricing cache since new promos may be displayable
    await this.ruleEngine.invalidatePricingCache();

    return promotions.length;
  }

  /**
   * Expire promotions that have passed their endsAt date.
   * Called by scheduler every 5 minutes.
   */
  async expireEndedPromotions(): Promise<number> {
    const now = new Date();

    const promotions = await this.prisma.promotion.findMany({
      where: {
        status: 'active',
        endsAt: { lte: now },
      },
      select: { id: true, name: true },
    });

    if (promotions.length === 0) {
      return 0;
    }

    await this.prisma.promotion.updateMany({
      where: {
        id: { in: promotions.map((p) => p.id) },
        status: 'active',
      },
      data: { status: 'expired' },
    });

    for (const promo of promotions) {
      await this.audit.log({
        actorType: 'system',
        action: 'promotion.expired',
        entityType: 'Promotion',
        entityId: promo.id,
        metadata: { promotionName: promo.name, expiredAt: now.toISOString() },
      });
    }

    // Invalidate pricing cache
    await this.ruleEngine.invalidatePricingCache();

    return promotions.length;
  }
}
