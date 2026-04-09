import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCampaignDto,
  UpdateCampaignDto,
  CreateCreativeDto,
  UpdateCreativeDto,
  RecordEventDto,
} from './dto';

const CAMPAIGN_SELECT = {
  id: true,
  name: true,
  status: true,
  startDate: true,
  endDate: true,
  priority: true,
  targetPages: true,
  targetUserType: true,
  maxImpressions: true,
  maxImpressionsPerUser: true,
  impressionCount: true,
  clickCount: true,
  dismissCount: true,
  showAfterSeconds: true,
  showOncePerSession: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  creatives: {
    select: {
      id: true,
      displayType: true,
      position: true,
      headline: true,
      bodyText: true,
      imageUrl: true,
      imageAlt: true,
      ctaText: true,
      ctaUrl: true,
      ctaStyle: true,
      secondaryCtaText: true,
      bgColor: true,
      textColor: true,
      accentColor: true,
      borderRadius: true,
      animation: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: 'asc' as const },
  },
} as const;

@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // =========================================================================
  // Public Endpoints
  // =========================================================================

  async getActiveCampaigns(page: string, userType?: string) {
    const now = new Date();

    const campaigns = await this.prisma.adCampaign.findMany({
      where: {
        status: 'active',
        OR: [
          { startDate: null },
          { startDate: { lte: now } },
        ],
        AND: [
          {
            OR: [
              { endDate: null },
              { endDate: { gte: now } },
            ],
          },
          {
            OR: [
              { targetPages: { has: page } },
              { targetPages: { has: '*' } },
            ],
          },
          {
            OR: [
              { targetUserType: null },
              ...(userType ? [{ targetUserType: userType }] : []),
            ],
          },
        ],
      },
      select: CAMPAIGN_SELECT,
      orderBy: { priority: 'desc' },
      take: 10,
    });

    // Filter out campaigns that have hit max impressions (done in app layer
    // since Prisma doesn't support comparing two columns in WHERE)
    return campaigns.filter((c) => {
      if (c.maxImpressions !== null && c.impressionCount >= c.maxImpressions) {
        return false;
      }
      return true;
    });
  }

  async recordEvent(dto: RecordEventDto, ipAddress?: string, userAgent?: string, userId?: string) {
    // Verify campaign exists
    const campaign = await this.prisma.adCampaign.findUnique({
      where: { id: dto.campaignId },
      select: { id: true, status: true },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    // Create event record
    await this.prisma.adEvent.create({
      data: {
        campaignId: dto.campaignId,
        creativeId: dto.creativeId,
        eventType: dto.eventType,
        userId,
        sessionId: dto.sessionId,
        page: dto.page,
        ipAddress,
        userAgent,
      },
    });

    // Fire-and-forget counter increments
    const counterField =
      dto.eventType === 'impression'
        ? 'impressionCount'
        : dto.eventType === 'click' || dto.eventType === 'cta_click'
          ? 'clickCount'
          : dto.eventType === 'dismiss'
            ? 'dismissCount'
            : null;

    if (counterField) {
      this.prisma.adCampaign
        .update({
          where: { id: dto.campaignId },
          data: { [counterField]: { increment: 1 } },
        })
        .catch((err) => this.logger.warn(`Failed to increment ${counterField}: ${err}`));
    }
  }

  // =========================================================================
  // Admin — Campaigns
  // =========================================================================

  async getAdminCampaigns(status?: string, cursor?: string, limit = 20) {
    const where: Record<string, unknown> = {};
    if (status) {
      where['status'] = status;
    }

    const items = await this.prisma.adCampaign.findMany({
      take: limit + 1,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      where,
      select: CAMPAIGN_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    const hasNext = items.length > limit;
    const campaigns = hasNext ? items.slice(0, -1) : items;
    const nextCursor = hasNext ? campaigns[campaigns.length - 1]?.id : undefined;

    return { items: campaigns, hasNext, nextCursor };
  }

  async getAdminCampaign(id: string) {
    const campaign = await this.prisma.adCampaign.findUnique({
      where: { id },
      select: CAMPAIGN_SELECT,
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    return campaign;
  }

  async createCampaign(dto: CreateCampaignDto, userId: string) {
    return this.prisma.adCampaign.create({
      data: {
        name: dto.name,
        status: dto.status ?? 'draft',
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        priority: dto.priority ?? 0,
        targetPages: dto.targetPages,
        targetUserType: dto.targetUserType,
        maxImpressions: dto.maxImpressions,
        maxImpressionsPerUser: dto.maxImpressionsPerUser,
        showAfterSeconds: dto.showAfterSeconds ?? 0,
        showOncePerSession: dto.showOncePerSession ?? true,
        createdBy: userId,
      },
      select: CAMPAIGN_SELECT,
    });
  }

  async updateCampaign(id: string, dto: UpdateCampaignDto) {
    const existing = await this.prisma.adCampaign.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Campaign not found');
    }

    return this.prisma.adCampaign.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.startDate !== undefined && { startDate: dto.startDate ? new Date(dto.startDate) : null }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.targetPages !== undefined && { targetPages: dto.targetPages }),
        ...(dto.targetUserType !== undefined && { targetUserType: dto.targetUserType }),
        ...(dto.maxImpressions !== undefined && { maxImpressions: dto.maxImpressions }),
        ...(dto.maxImpressionsPerUser !== undefined && { maxImpressionsPerUser: dto.maxImpressionsPerUser }),
        ...(dto.showAfterSeconds !== undefined && { showAfterSeconds: dto.showAfterSeconds }),
        ...(dto.showOncePerSession !== undefined && { showOncePerSession: dto.showOncePerSession }),
      },
      select: CAMPAIGN_SELECT,
    });
  }

  async updateCampaignStatus(id: string, status: string) {
    const existing = await this.prisma.adCampaign.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Campaign not found');
    }

    return this.prisma.adCampaign.update({
      where: { id },
      data: { status },
      select: CAMPAIGN_SELECT,
    });
  }

  async deleteCampaign(id: string) {
    const existing = await this.prisma.adCampaign.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Campaign not found');
    }

    await this.prisma.adCampaign.delete({ where: { id } });
  }

  // =========================================================================
  // Admin — Creatives
  // =========================================================================

  async createCreative(campaignId: string, dto: CreateCreativeDto) {
    const campaign = await this.prisma.adCampaign.findUnique({
      where: { id: campaignId },
      select: { id: true },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    // Validate CTA URL if provided
    if (dto.ctaUrl) {
      this.validateCtaUrl(dto.ctaUrl);
    }

    return this.prisma.adCreative.create({
      data: {
        campaignId,
        displayType: dto.displayType,
        position: dto.position,
        headline: dto.headline,
        bodyText: dto.bodyText,
        imageUrl: dto.imageUrl,
        imageAlt: dto.imageAlt,
        ctaText: dto.ctaText,
        ctaUrl: dto.ctaUrl,
        ctaStyle: dto.ctaStyle,
        secondaryCtaText: dto.secondaryCtaText,
        bgColor: dto.bgColor,
        textColor: dto.textColor,
        accentColor: dto.accentColor,
        borderRadius: dto.borderRadius,
        animation: dto.animation,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateCreative(creativeId: string, dto: UpdateCreativeDto) {
    const existing = await this.prisma.adCreative.findUnique({
      where: { id: creativeId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Creative not found');
    }

    if (dto.ctaUrl) {
      this.validateCtaUrl(dto.ctaUrl);
    }

    return this.prisma.adCreative.update({
      where: { id: creativeId },
      data: {
        ...(dto.displayType !== undefined && { displayType: dto.displayType }),
        ...(dto.position !== undefined && { position: dto.position }),
        ...(dto.headline !== undefined && { headline: dto.headline }),
        ...(dto.bodyText !== undefined && { bodyText: dto.bodyText }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.imageAlt !== undefined && { imageAlt: dto.imageAlt }),
        ...(dto.ctaText !== undefined && { ctaText: dto.ctaText }),
        ...(dto.ctaUrl !== undefined && { ctaUrl: dto.ctaUrl }),
        ...(dto.ctaStyle !== undefined && { ctaStyle: dto.ctaStyle }),
        ...(dto.secondaryCtaText !== undefined && { secondaryCtaText: dto.secondaryCtaText }),
        ...(dto.bgColor !== undefined && { bgColor: dto.bgColor }),
        ...(dto.textColor !== undefined && { textColor: dto.textColor }),
        ...(dto.accentColor !== undefined && { accentColor: dto.accentColor }),
        ...(dto.borderRadius !== undefined && { borderRadius: dto.borderRadius }),
        ...(dto.animation !== undefined && { animation: dto.animation }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async deleteCreative(creativeId: string) {
    const existing = await this.prisma.adCreative.findUnique({
      where: { id: creativeId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Creative not found');
    }

    await this.prisma.adCreative.delete({ where: { id: creativeId } });
  }

  // =========================================================================
  // Admin — Analytics
  // =========================================================================

  async getCampaignAnalytics(campaignId: string) {
    const campaign = await this.prisma.adCampaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        impressionCount: true,
        clickCount: true,
        dismissCount: true,
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const ctr =
      campaign.impressionCount > 0
        ? ((campaign.clickCount / campaign.impressionCount) * 100).toFixed(2)
        : '0.00';

    // Get events breakdown by page
    const byPage = await this.prisma.adEvent.groupBy({
      by: ['page', 'eventType'],
      where: { campaignId },
      _count: true,
    });

    // Get recent events
    const recentEvents = await this.prisma.adEvent.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        eventType: true,
        page: true,
        sessionId: true,
        createdAt: true,
      },
    });

    return {
      summary: {
        impressions: campaign.impressionCount,
        clicks: campaign.clickCount,
        dismissals: campaign.dismissCount,
        ctr: parseFloat(ctr),
      },
      byPage,
      recentEvents,
    };
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private validateCtaUrl(url: string): void {
    // Allow internal paths and https:// URLs only (no javascript: or data: URIs)
    if (url.startsWith('/')) return;
    if (url.startsWith('https://')) return;
    throw new BadRequestException(
      'CTA URL must be an internal path (starting with /) or a secure URL (https://)',
    );
  }
}
