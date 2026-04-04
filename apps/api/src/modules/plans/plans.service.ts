import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Plan, PlanEntitlement, PlanPrice } from '@prisma/client';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { SubscriptionEntitlements } from '../subscriptions/subscriptions.service';
import type { CreatePlanDto } from './dto/create-plan.dto';
import type { UpdatePlanDto } from './dto/update-plan.dto';
import type { CreatePlanPriceDto } from './dto/create-plan-price.dto';
import type { UpdatePlanPriceDto } from './dto/update-plan-price.dto';
import type { CreatePlanEntitlementDto } from './dto/create-plan-entitlement.dto';
import type { UpdatePlanEntitlementDto } from './dto/update-plan-entitlement.dto';

/** Tier hierarchy: higher index = higher tier */
const TIER_HIERARCHY: Record<string, number> = {
  free: 0,
  edu: 1,
  pro: 2,
  team: 3,
  enterprise: 4,
};

/** Cache TTL for plan data in Redis (seconds) */
const PLAN_CACHE_TTL = 300; // 5 minutes

/** Cache key prefix for individual plans */
const PLAN_CACHE_PREFIX = 'cache:plan:';

/** Cache key for the visible plans list */
const VISIBLE_PLANS_CACHE_KEY = 'cache:plans:visible';

export interface PlanWithDetails extends Plan {
  prices: PlanPrice[];
  entitlements: PlanEntitlement[];
}

export interface PlanComparisonResult {
  fromPlan: string;
  toPlan: string;
  direction: 'upgrade' | 'downgrade' | 'same';
  addedEntitlements: string[];
  removedEntitlements: string[];
  changedEntitlements: { key: string; from: string; to: string }[];
}

@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ---- Read Operations ----

  /**
   * Get all active plans ordered by displayOrder.
   */
  async findAll(): Promise<PlanWithDetails[]> {
    return this.prisma.plan.findMany({
      where: { isActive: true, isArchived: false },
      include: { prices: { where: { isActive: true } }, entitlements: true },
      orderBy: { displayOrder: 'asc' },
    }) as Promise<PlanWithDetails[]>;
  }

  /**
   * Get visible plans for the public pricing page.
   * Cached in Redis for 5 minutes.
   */
  async findVisible(): Promise<PlanWithDetails[]> {
    // Check cache
    const cached = await this.redis.get(VISIBLE_PLANS_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as PlanWithDetails[];
    }

    const plans = await this.prisma.plan.findMany({
      where: { isActive: true, isVisible: true, isArchived: false },
      include: { prices: { where: { isActive: true } }, entitlements: true },
      orderBy: { displayOrder: 'asc' },
    }) as PlanWithDetails[];

    await this.redis.set(VISIBLE_PLANS_CACHE_KEY, JSON.stringify(plans), PLAN_CACHE_TTL);
    return plans;
  }

  /**
   * Get a plan by its unique code with full details.
   * Cached in Redis for 5 minutes.
   */
  async findByCode(code: string): Promise<PlanWithDetails> {
    const cacheKey = `${PLAN_CACHE_PREFIX}${code}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as PlanWithDetails;
    }

    const plan = await this.prisma.plan.findUnique({
      where: { code },
      include: {
        prices: { where: { isActive: true } },
        entitlements: true,
      },
    }) as PlanWithDetails | null;

    if (!plan) {
      throw new NotFoundException(`Plan not found: ${code}`);
    }

    await this.redis.set(cacheKey, JSON.stringify(plan), PLAN_CACHE_TTL);
    return plan;
  }

  /**
   * Get a plan by its UUID.
   */
  async findById(id: string): Promise<PlanWithDetails> {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: {
        prices: { where: { isActive: true } },
        entitlements: true,
      },
    }) as PlanWithDetails | null;

    if (!plan) {
      throw new NotFoundException(`Plan not found: ${id}`);
    }

    return plan;
  }

  // ---- Entitlement Resolution ----

  /**
   * Resolve SubscriptionEntitlements from PlanEntitlement DB rows.
   * This replaces the hardcoded getDefaultEntitlements() when billing.db_plans flag is ON.
   */
  async resolveEntitlements(planCode: string): Promise<SubscriptionEntitlements> {
    const plan = await this.findByCode(planCode);
    return this.entitlementsFromRows(plan.entitlements);
  }

  /**
   * Convert PlanEntitlement rows into a SubscriptionEntitlements object.
   */
  entitlementsFromRows(rows: PlanEntitlement[]): SubscriptionEntitlements {
    const result: Record<string, unknown> = {};

    for (const row of rows) {
      switch (row.valueType) {
        case 'unlimited':
          result[row.key] = -1;
          break;
        case 'numeric':
          result[row.key] = row.numericValue ?? 0;
          break;
        case 'boolean':
          result[row.key] = row.booleanValue ?? false;
          break;
        default:
          result[row.key] = row.numericValue ?? row.booleanValue ?? 0;
      }
    }

    return result as SubscriptionEntitlements;
  }

  // ---- Tier Comparison ----

  /**
   * Get the tier level for a plan code (0-based).
   */
  getTierLevel(planCode: string): number {
    return TIER_HIERARCHY[planCode] ?? 0;
  }

  /**
   * Compare two plans and describe the differences.
   */
  async comparePlans(fromCode: string, toCode: string): Promise<PlanComparisonResult> {
    const [fromPlan, toPlan] = await Promise.all([
      this.findByCode(fromCode),
      this.findByCode(toCode),
    ]);

    const fromLevel = this.getTierLevel(fromCode);
    const toLevel = this.getTierLevel(toCode);

    const direction: 'upgrade' | 'downgrade' | 'same' =
      toLevel > fromLevel ? 'upgrade' : toLevel < fromLevel ? 'downgrade' : 'same';

    const fromEntMap = new Map(fromPlan.entitlements.map((e) => [e.key, e]));
    const toEntMap = new Map(toPlan.entitlements.map((e) => [e.key, e]));

    const allKeys = new Set([...fromEntMap.keys(), ...toEntMap.keys()]);
    const addedEntitlements: string[] = [];
    const removedEntitlements: string[] = [];
    const changedEntitlements: { key: string; from: string; to: string }[] = [];

    for (const key of allKeys) {
      const fromEnt = fromEntMap.get(key);
      const toEnt = toEntMap.get(key);

      if (!fromEnt && toEnt) {
        addedEntitlements.push(key);
      } else if (fromEnt && !toEnt) {
        removedEntitlements.push(key);
      } else if (fromEnt && toEnt) {
        const fromVal = this.entitlementDisplayValue(fromEnt);
        const toVal = this.entitlementDisplayValue(toEnt);
        if (fromVal !== toVal) {
          changedEntitlements.push({ key, from: fromVal, to: toVal });
        }
      }
    }

    return {
      fromPlan: fromCode,
      toPlan: toCode,
      direction,
      addedEntitlements,
      removedEntitlements,
      changedEntitlements,
    };
  }

  // ---- Eligibility ----

  /**
   * Check if an organization is eligible for a specific plan.
   */
  async checkEligibility(
    planCode: string,
    orgId: string,
  ): Promise<{ eligible: boolean; reason?: string }> {
    const plan = await this.findByCode(planCode);

    if (!plan.isActive) {
      return { eligible: false, reason: 'Plan is not active' };
    }

    if (plan.isArchived) {
      return { eligible: false, reason: 'Plan is archived' };
    }

    if (plan.adminOnlyAssignment) {
      return { eligible: false, reason: 'Plan can only be assigned by an administrator' };
    }

    if (plan.inviteOnly) {
      return { eligible: false, reason: 'Plan is invite-only' };
    }

    // Check eligible segments if defined
    const segments = plan.eligibleSegments as string[];
    if (segments && segments.length > 0) {
      const org = await this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { type: true },
      });

      if (!org) {
        return { eligible: false, reason: 'Organization not found' };
      }

      // Map org type to segment
      const orgSegment = this.orgTypeToSegment(org.type);
      if (!segments.includes(orgSegment)) {
        return {
          eligible: false,
          reason: `Plan is only available for: ${segments.join(', ')}`,
        };
      }
    }

    return { eligible: true };
  }

  // ---- Admin Read Operations ----

  /**
   * Get all plans for admin view (includes archived/inactive).
   */
  async findAllAdmin(): Promise<PlanWithDetails[]> {
    return this.prisma.plan.findMany({
      include: { prices: true, entitlements: true },
      orderBy: { displayOrder: 'asc' },
    }) as Promise<PlanWithDetails[]>;
  }

  // ---- Plan CRUD ----

  /**
   * Create a new plan.
   */
  async create(dto: CreatePlanDto): Promise<PlanWithDetails> {
    // Check for duplicate code
    const existing = await this.prisma.plan.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`Plan with code "${dto.code}" already exists`);
    }

    const plan = await this.prisma.plan.create({
      data: {
        code: dto.code,
        name: dto.name,
        displayName: dto.displayName ?? dto.name,
        description: dto.description,
        type: dto.type,
        category: dto.category,
        isActive: dto.isActive ?? true,
        isVisible: dto.isVisible ?? true,
        displayOrder: dto.displayOrder ?? 0,
        trialEnabled: dto.trialEnabled ?? false,
        trialDurationDays: dto.trialDurationDays,
        gracePeriodDays: dto.gracePeriodDays,
        autoRenewRequired: dto.autoRenewRequired ?? true,
        adminOnlyAssignment: dto.adminOnlyAssignment ?? false,
        inviteOnly: dto.inviteOnly ?? false,
        eligibleSegments: dto.eligibleSegments ?? [],
        maxSeats: dto.maxSeats,
        internalNotes: dto.internalNotes,
      },
      include: { prices: true, entitlements: true },
    }) as PlanWithDetails;

    await this.invalidateCache();
    this.logger.log(`Plan created: ${plan.code} (${plan.id})`);
    return plan;
  }

  /**
   * Update an existing plan.
   */
  async update(id: string, dto: UpdatePlanDto): Promise<PlanWithDetails> {
    const existing = await this.prisma.plan.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Plan not found: ${id}`);
    }

    // If code is being changed, check for conflicts
    if (dto.code && dto.code !== existing.code) {
      const conflict = await this.prisma.plan.findUnique({
        where: { code: dto.code },
      });
      if (conflict) {
        throw new ConflictException(`Plan with code "${dto.code}" already exists`);
      }
    }

    const plan = await this.prisma.plan.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.isVisible !== undefined && { isVisible: dto.isVisible }),
        ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
        ...(dto.trialEnabled !== undefined && { trialEnabled: dto.trialEnabled }),
        ...(dto.trialDurationDays !== undefined && { trialDurationDays: dto.trialDurationDays }),
        ...(dto.gracePeriodDays !== undefined && { gracePeriodDays: dto.gracePeriodDays }),
        ...(dto.autoRenewRequired !== undefined && { autoRenewRequired: dto.autoRenewRequired }),
        ...(dto.adminOnlyAssignment !== undefined && { adminOnlyAssignment: dto.adminOnlyAssignment }),
        ...(dto.inviteOnly !== undefined && { inviteOnly: dto.inviteOnly }),
        ...(dto.eligibleSegments !== undefined && { eligibleSegments: dto.eligibleSegments }),
        ...(dto.maxSeats !== undefined && { maxSeats: dto.maxSeats }),
        ...(dto.internalNotes !== undefined && { internalNotes: dto.internalNotes }),
      },
      include: { prices: true, entitlements: true },
    }) as PlanWithDetails;

    await this.invalidateCache(existing.code);
    if (dto.code && dto.code !== existing.code) {
      await this.invalidateCache(dto.code);
    }
    this.logger.log(`Plan updated: ${plan.code} (${plan.id})`);
    return plan;
  }

  /**
   * Archive a plan (soft-delete). Archived plans are not available for new subscriptions.
   */
  async archive(id: string): Promise<PlanWithDetails> {
    const existing = await this.prisma.plan.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Plan not found: ${id}`);
    }

    // Check if any active subscriptions use this plan
    const activeSubCount = await this.prisma.subscription.count({
      where: { planId: id, status: 'active' },
    });
    if (activeSubCount > 0) {
      throw new BadRequestException(
        `Cannot archive plan with ${activeSubCount} active subscription(s). Deactivate or migrate them first.`,
      );
    }

    const plan = await this.prisma.plan.update({
      where: { id },
      data: { isArchived: true, isActive: false, isVisible: false },
      include: { prices: true, entitlements: true },
    }) as PlanWithDetails;

    await this.invalidateCache(existing.code);
    this.logger.log(`Plan archived: ${plan.code} (${plan.id})`);
    return plan;
  }

  // ---- Price CRUD ----

  /**
   * Add a price tier to a plan.
   */
  async createPrice(planId: string, dto: CreatePlanPriceDto): Promise<PlanPrice> {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new NotFoundException(`Plan not found: ${planId}`);
    }

    const currency = dto.currency ?? 'PHP';

    // Check for duplicate interval+currency
    const existing = await this.prisma.planPrice.findUnique({
      where: {
        planId_billingInterval_currency: {
          planId,
          billingInterval: dto.billingInterval,
          currency,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Price already exists for ${dto.billingInterval}/${currency}. Update the existing price instead.`,
      );
    }

    const price = await this.prisma.planPrice.create({
      data: {
        planId,
        billingInterval: dto.billingInterval,
        amount: dto.amount,
        currency,
      },
    });

    await this.invalidateCache(plan.code);
    this.logger.log(`Plan price created: ${plan.code} ${dto.billingInterval} ${dto.amount}`);
    return price;
  }

  /**
   * Update a plan price.
   */
  async updatePrice(planId: string, priceId: string, dto: UpdatePlanPriceDto): Promise<PlanPrice> {
    const price = await this.prisma.planPrice.findFirst({
      where: { id: priceId, planId },
      include: { plan: { select: { code: true } } },
    });
    if (!price) {
      throw new NotFoundException(`Price not found: ${priceId}`);
    }

    const updated = await this.prisma.planPrice.update({
      where: { id: priceId },
      data: {
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.invalidateCache(price.plan.code);
    this.logger.log(`Plan price updated: ${priceId}`);
    return updated;
  }

  /**
   * Deactivate a price tier.
   */
  async deactivatePrice(planId: string, priceId: string): Promise<PlanPrice> {
    return this.updatePrice(planId, priceId, { isActive: false });
  }

  // ---- Entitlement CRUD ----

  /**
   * Add an entitlement to a plan.
   */
  async createEntitlement(
    planId: string,
    dto: CreatePlanEntitlementDto,
  ): Promise<PlanEntitlement> {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new NotFoundException(`Plan not found: ${planId}`);
    }

    // Check for duplicate key
    const existing = await this.prisma.planEntitlement.findUnique({
      where: { planId_key: { planId, key: dto.key } },
    });
    if (existing) {
      throw new ConflictException(
        `Entitlement "${dto.key}" already exists for this plan. Update the existing one instead.`,
      );
    }

    const entitlement = await this.prisma.planEntitlement.create({
      data: {
        planId,
        key: dto.key,
        valueType: dto.valueType,
        numericValue: dto.numericValue,
        booleanValue: dto.booleanValue,
        description: dto.description,
      },
    });

    await this.invalidateCache(plan.code);
    this.logger.log(`Plan entitlement created: ${plan.code} → ${dto.key}`);
    return entitlement;
  }

  /**
   * Update a plan entitlement.
   */
  async updateEntitlement(
    planId: string,
    entitlementId: string,
    dto: UpdatePlanEntitlementDto,
  ): Promise<PlanEntitlement> {
    const entitlement = await this.prisma.planEntitlement.findFirst({
      where: { id: entitlementId, planId },
    });
    if (!entitlement) {
      throw new NotFoundException(`Entitlement not found: ${entitlementId}`);
    }

    // If key is being changed, check for conflicts
    if (dto.key && dto.key !== entitlement.key) {
      const conflict = await this.prisma.planEntitlement.findUnique({
        where: { planId_key: { planId, key: dto.key } },
      });
      if (conflict) {
        throw new ConflictException(
          `Entitlement "${dto.key}" already exists for this plan`,
        );
      }
    }

    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      select: { code: true },
    });

    const updated = await this.prisma.planEntitlement.update({
      where: { id: entitlementId },
      data: {
        ...(dto.key !== undefined && { key: dto.key }),
        ...(dto.valueType !== undefined && { valueType: dto.valueType }),
        ...(dto.numericValue !== undefined && { numericValue: dto.numericValue }),
        ...(dto.booleanValue !== undefined && { booleanValue: dto.booleanValue }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });

    if (plan) {
      await this.invalidateCache(plan.code);
    }
    this.logger.log(`Plan entitlement updated: ${entitlementId}`);
    return updated;
  }

  /**
   * Delete a plan entitlement.
   */
  async deleteEntitlement(planId: string, entitlementId: string): Promise<void> {
    const entitlement = await this.prisma.planEntitlement.findFirst({
      where: { id: entitlementId, planId },
    });
    if (!entitlement) {
      throw new NotFoundException(`Entitlement not found: ${entitlementId}`);
    }

    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      select: { code: true },
    });

    await this.prisma.planEntitlement.delete({ where: { id: entitlementId } });

    if (plan) {
      await this.invalidateCache(plan.code);
    }
    this.logger.log(`Plan entitlement deleted: ${entitlementId}`);
  }

  // ---- Cache Invalidation ----

  /**
   * Invalidate all plan caches. Call after plan/price/entitlement changes.
   */
  async invalidateCache(planCode?: string): Promise<void> {
    await this.redis.del(VISIBLE_PLANS_CACHE_KEY);
    if (planCode) {
      await this.redis.del(`${PLAN_CACHE_PREFIX}${planCode}`);
    }
    this.logger.debug(`Plan cache invalidated${planCode ? ` for ${planCode}` : ' (all)'}`);
  }

  // ---- Private Helpers ----

  private entitlementDisplayValue(ent: PlanEntitlement): string {
    switch (ent.valueType) {
      case 'unlimited':
        return 'unlimited';
      case 'numeric':
        return String(ent.numericValue ?? 0);
      case 'boolean':
        return String(ent.booleanValue ?? false);
      default:
        return '0';
    }
  }

  private orgTypeToSegment(orgType: string): string {
    const mapping: Record<string, string> = {
      individual: 'solo_lawyer',
      firm: 'firm',
      school: 'law_student',
      editorial: 'editorial',
      team: 'firm',
    };
    return mapping[orgType] ?? orgType;
  }
}
