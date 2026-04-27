import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateSourceDto,
  UpdateSourceDto,
  CreateSourceEndpointDto,
  UpdateSourceEndpointDto,
  CoverageGapQueryDto,
  IngestionTrendsQueryDto,
  IngestionJobHistoryQueryDto,
} from './dto';

@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---- Source CRUD ----

  async create(dto: CreateSourceDto) {
    return this.prisma.source.create({
      data: {
        name: dto.name.trim(),
        type: dto.type,
        domain: dto.domain?.trim(),
        trustLevel: dto.trustLevel ?? 'medium',
        enabled: dto.enabled ?? true,
        fetchStrategy: dto.fetchStrategy ?? 'crawler',
      },
    });
  }

  async findById(id: string) {
    const source = await this.prisma.source.findUnique({
      where: { id },
      include: {
        endpoints: { orderBy: { status: 'asc' } },
        _count: { select: { legalDocuments: true, ingestionJobs: true } },
      },
    });

    if (!source) {
      throw new NotFoundException('Source not found');
    }

    return source;
  }

  async list() {
    return this.prisma.source.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { legalDocuments: true, endpoints: true, ingestionJobs: true } },
        endpoints: {
          select: {
            id: true,
            endpointUrl: true,
            parserType: true,
            status: true,
            lastFetchedAt: true,
            lastSuccessAt: true,
          },
          orderBy: { status: 'asc' },
        },
      },
    });
  }

  async update(id: string, dto: UpdateSourceDto) {
    await this.assertSourceExists(id);

    return this.prisma.source.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.domain !== undefined && { domain: dto.domain.trim() }),
        ...(dto.trustLevel !== undefined && { trustLevel: dto.trustLevel }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.fetchStrategy !== undefined && { fetchStrategy: dto.fetchStrategy }),
      },
    });
  }

  // ---- Source Endpoints ----

  async createEndpoint(sourceId: string, dto: CreateSourceEndpointDto) {
    await this.assertSourceExists(sourceId);

    return this.prisma.sourceEndpoint.create({
      data: {
        sourceId,
        endpointUrl: dto.endpointUrl.trim(),
        parserType: dto.parserType.trim(),
        contentTypeHint: dto.contentTypeHint?.trim(),
        scheduleCron: dto.scheduleCron?.trim(),
        status: dto.status ?? 'active',
      },
    });
  }

  async updateEndpoint(sourceId: string, endpointId: string, dto: UpdateSourceEndpointDto) {
    await this.assertSourceExists(sourceId);
    await this.assertEndpointExists(endpointId, sourceId);

    return this.prisma.sourceEndpoint.update({
      where: { id: endpointId },
      data: {
        ...(dto.endpointUrl !== undefined && { endpointUrl: dto.endpointUrl.trim() }),
        ...(dto.parserType !== undefined && { parserType: dto.parserType.trim() }),
        ...(dto.contentTypeHint !== undefined && { contentTypeHint: dto.contentTypeHint.trim() }),
        ...(dto.scheduleCron !== undefined && { scheduleCron: dto.scheduleCron.trim() }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  async deleteEndpoint(sourceId: string, endpointId: string) {
    await this.assertSourceExists(sourceId);
    await this.assertEndpointExists(endpointId, sourceId);

    await this.prisma.sourceEndpoint.delete({ where: { id: endpointId } });
  }

  // ---- Ingestion Jobs ----

  async listIngestionJobs(sourceId?: string, limit = 50) {
    return this.prisma.ingestionJob.findMany({
      where: sourceId ? { sourceId } : undefined,
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: {
        source: { select: { id: true, name: true } },
        sourceEndpoint: { select: { id: true, endpointUrl: true } },
      },
    });
  }

  async createIngestionJob(sourceId: string, endpointId?: string) {
    await this.assertSourceExists(sourceId);

    return this.prisma.ingestionJob.create({
      data: {
        sourceId,
        sourceEndpointId: endpointId,
        jobType: 'fetch',
        status: 'pending',
        startedAt: new Date(),
      },
    });
  }

  // ---- Source Health ----

  async getCorpusHealth() {
    const totalDocuments = await this.prisma.legalDocument.count();
    const publishedDocuments = await this.prisma.legalDocument.count({ where: { isPublished: true } });
    const draftDocuments = await this.prisma.legalDocument.count({ where: { status: 'draft' } });
    const needsReview = await this.prisma.legalDocument.count({ where: { truthfulnessStatus: 'needs_review' } });
    const quarantined = await this.prisma.legalDocument.count({ where: { truthfulnessStatus: 'quarantined' } });

    const documentsByType = await this.prisma.legalDocument.groupBy({
      by: ['documentType'],
      _count: true,
    });

    const sourceHealth = await this.prisma.source.findMany({
      where: { enabled: true },
      select: {
        id: true,
        name: true,
        type: true,
        trustLevel: true,
        _count: { select: { legalDocuments: true } },
        endpoints: {
          select: {
            lastFetchedAt: true,
            lastSuccessAt: true,
            status: true,
          },
        },
      },
    });

    const pendingReviewDigests = await this.prisma.digest.count({
      where: { reviewStatus: 'needs_human_review' },
    });

    const openFlags = await this.prisma.editorialFlag.count({
      where: { status: 'open' },
    });

    const pipelineOps = await this.getPipelineOpsStats();

    return {
      corpus: {
        total: totalDocuments,
        published: publishedDocuments,
        draft: draftDocuments,
        needsReview,
        quarantined,
      },
      documentsByType: documentsByType.map((g) => ({
        type: g.documentType,
        count: g._count,
      })),
      sources: sourceHealth.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        trustLevel: s.trustLevel,
        documentCount: s._count.legalDocuments,
        endpoints: s.endpoints,
      })),
      reviewQueue: {
        pendingDigests: pendingReviewDigests,
        openFlags,
      },
      pipelineOps,
    };
  }

  /**
   * Aggregate metrics for the admin landing-page Pipeline Operations tile.
   * Kept inside SourcesService so the existing /admin/corpus-health hook
   * picks it up without adding a second round-trip.
   */
  async getPipelineOpsStats() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      activeBatches,
      last24hAutoPromotions,
      citationsTotal,
      pendingReviewQueue,
    ] = await Promise.all([
      this.prisma.backfillBatch.findMany({
        where: { status: 'running' },
        select: {
          id: true,
          name: true,
          status: true,
          candidatesProcessed: true,
          candidatesDiscovered: true,
          lastTickAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.auditLog.count({
        where: {
          action: 'derivative_auto_promoted',
          createdAt: { gte: since24h },
        },
      }),
      this.prisma.citation.count(),
      this.prisma.derivativeArtifact.count({
        where: {
          reviewStatus: { in: ['draft', 'needs_human_review'] },
          visibility: 'private',
          deletedAt: null,
        },
      }),
    ]);

    return {
      activeBackfillBatches: {
        count: activeBatches.length,
        items: activeBatches.map((b) => ({
          id: b.id,
          name: b.name,
          status: b.status,
          candidatesProcessed: b.candidatesProcessed,
          candidatesTotal: b.candidatesDiscovered,
          lastTickAt: b.lastTickAt ? b.lastTickAt.toISOString() : null,
        })),
      },
      last24hAutoPromotions,
      citationsTotal,
      pendingReviewQueue,
    };
  }

  // ---- Editorial Review Queue ----

  async getReviewQueue(cursor?: string, limit = 20) {
    const digests = await this.prisma.digest.findMany({
      where: { reviewStatus: { in: ['ai_generated', 'needs_human_review'] } },
      take: limit + 1,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      orderBy: { createdAt: 'asc' },
      include: {
        legalDocument: {
          select: { id: true, title: true, citationText: true, grNo: true },
        },
        user: { select: { id: true, fullName: true } },
      },
    });

    const hasNext = digests.length > limit;
    const items = hasNext ? digests.slice(0, limit) : digests;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return { items, meta: { hasNext, nextCursor } };
  }

  async approveDigest(digestId: string, reviewerUserId: string, notes?: string) {
    const digest = await this.prisma.digest.findUnique({ where: { id: digestId } });
    if (!digest) throw new NotFoundException('Digest not found');

    return this.prisma.$transaction([
      this.prisma.digest.update({
        where: { id: digestId },
        data: { reviewStatus: 'approved' },
      }),
      this.prisma.digestReview.create({
        data: {
          digestId,
          reviewerUserId,
          verdict: 'approve',
          notes,
        },
      }),
    ]);
  }

  async rejectDigest(digestId: string, reviewerUserId: string, notes?: string) {
    const digest = await this.prisma.digest.findUnique({ where: { id: digestId } });
    if (!digest) throw new NotFoundException('Digest not found');

    return this.prisma.$transaction([
      this.prisma.digest.update({
        where: { id: digestId },
        data: { reviewStatus: 'rejected' },
      }),
      this.prisma.digestReview.create({
        data: {
          digestId,
          reviewerUserId,
          verdict: 'reject',
          notes,
        },
      }),
    ]);
  }

  // ---- Editorial Flags ----

  async listEditorialFlags(status?: string) {
    return this.prisma.editorialFlag.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        legalDocument: { select: { id: true, title: true, citationText: true } },
        digest: { select: { id: true, title: true } },
      },
    });
  }

  // ---- Per-Source Health Scoring ----

  async computeSourceHealth(sourceId: string) {
    await this.assertSourceExists(sourceId);

    const source = await this.prisma.source.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        endpoints: {
          select: { id: true, status: true, lastFetchedAt: true, lastSuccessAt: true },
        },
        _count: { select: { legalDocuments: true, ingestionJobs: true } },
      },
    });

    const endpoints = source.endpoints;
    const totalEndpoints = endpoints.length;

    // Component 1: Endpoint availability (0.2 weight)
    const activeEndpoints = endpoints.filter((e) => e.status === 'active').length;
    const endpointAvailability = totalEndpoints > 0 ? activeEndpoints / totalEndpoints : 0;

    // Component 2: Fetch success rate (0.3 weight)
    const recentJobs = await this.prisma.ingestionJob.findMany({
      where: { sourceId, startedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      select: { status: true },
    });
    const completedJobs = recentJobs.filter((j) => j.status === 'completed').length;
    const fetchSuccessRate = recentJobs.length > 0 ? completedJobs / recentJobs.length : 0;

    // Component 3: Document quality (0.3 weight)
    const totalDocs = source._count.legalDocuments;
    const publishedDocs = totalDocs > 0
      ? await this.prisma.legalDocument.count({
          where: { sourceId, isPublished: true },
        })
      : 0;
    const quarantinedDocs = totalDocs > 0
      ? await this.prisma.legalDocument.count({
          where: { sourceId, truthfulnessStatus: 'quarantined' },
        })
      : 0;
    const documentQuality = totalDocs > 0
      ? (publishedDocs - quarantinedDocs * 2) / totalDocs
      : 0;
    const clampedQuality = Math.max(0, Math.min(1, documentQuality));

    // Component 4: Freshness (0.2 weight)
    const latestFetch = endpoints
      .map((e) => e.lastFetchedAt)
      .filter(Boolean)
      .sort((a, b) => (b as Date).getTime() - (a as Date).getTime())[0];

    let freshness = 0;
    if (latestFetch) {
      const daysSinceFetch = (Date.now() - (latestFetch as Date).getTime()) / (24 * 60 * 60 * 1000);
      // 0 days = 1.0, 30 days = 0.0
      freshness = Math.max(0, Math.min(1, 1 - daysSinceFetch / 30));
    }

    // Weighted score
    const healthScore =
      endpointAvailability * 0.2 +
      fetchSuccessRate * 0.3 +
      clampedQuality * 0.3 +
      freshness * 0.2;

    const roundedScore = Math.round(healthScore * 100) / 100;

    const components = {
      endpointAvailability: Math.round(endpointAvailability * 100) / 100,
      fetchSuccessRate: Math.round(fetchSuccessRate * 100) / 100,
      documentQuality: Math.round(clampedQuality * 100) / 100,
      freshness: Math.round(freshness * 100) / 100,
    };

    // Persist to Source record
    await this.prisma.source.update({
      where: { id: sourceId },
      data: {
        healthScore: roundedScore,
        lastHealthCheckAt: new Date(),
        healthMetadataJson: components,
      },
    });

    return {
      sourceId,
      sourceName: source.name,
      healthScore: roundedScore,
      components,
      lastHealthCheckAt: new Date().toISOString(),
      enabled: source.enabled,
      documentCount: totalDocs,
      endpointCount: totalEndpoints,
    };
  }

  async computeAllSourceHealth() {
    const sources = await this.prisma.source.findMany({
      where: { enabled: true },
      select: { id: true },
    });

    const results = [];
    for (const source of sources) {
      const report = await this.computeSourceHealth(source.id);
      results.push(report);
    }

    return results;
  }

  async getSourceHealthReport(sourceId: string) {
    await this.assertSourceExists(sourceId);

    const source = await this.prisma.source.findUniqueOrThrow({
      where: { id: sourceId },
      select: {
        id: true,
        name: true,
        enabled: true,
        healthScore: true,
        lastHealthCheckAt: true,
        healthMetadataJson: true,
        _count: { select: { legalDocuments: true, endpoints: true } },
      },
    });

    // Return cached if health check is less than 1 hour old
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (source.healthScore !== null && source.lastHealthCheckAt && source.lastHealthCheckAt > oneHourAgo) {
      return {
        sourceId: source.id,
        sourceName: source.name,
        healthScore: source.healthScore,
        components: source.healthMetadataJson ?? {},
        lastHealthCheckAt: source.lastHealthCheckAt.toISOString(),
        enabled: source.enabled,
        documentCount: source._count.legalDocuments,
        endpointCount: source._count.endpoints,
      };
    }

    // Recompute if stale
    return this.computeSourceHealth(sourceId);
  }

  async getCoverageGapAnalysis() {
    // Coverage by document type
    const byType = await this.prisma.legalDocument.groupBy({
      by: ['documentType'],
      _count: true,
      _max: { createdAt: true },
    });

    // Coverage by court
    const byCourt = await this.prisma.legalDocument.groupBy({
      by: ['court'],
      _count: true,
      _max: { decisionDate: true },
      where: { court: { not: null } },
    });

    const typeGaps = byType.map((g) => ({
      dimension: 'documentType',
      value: g.documentType,
      documentCount: g._count,
      latestDate: g._max.createdAt?.toISOString() ?? null,
    }));

    const courtGaps = byCourt.map((g) => ({
      dimension: 'court',
      value: g.court as string,
      documentCount: g._count,
      latestDate: g._max.decisionDate?.toISOString() ?? null,
    }));

    // Coverage by subject tag (from tag maps)
    const byTag = await this.prisma.legalDocumentTagMap.groupBy({
      by: ['tagId'],
      _count: true,
    });

    const tagIds = byTag.map((g) => g.tagId);
    const tags = tagIds.length > 0
      ? await this.prisma.legalMetadataTag.findMany({
          where: { id: { in: tagIds } },
          select: { id: true, name: true },
        })
      : [];

    const tagMap = new Map(tags.map((t: { id: string; name: string }) => [t.id, t.name]));
    const tagGaps = byTag.map((g) => ({
      dimension: 'tag',
      value: tagMap.get(g.tagId) ?? g.tagId,
      documentCount: g._count,
      latestDate: null,
    }));

    return {
      byDocumentType: typeGaps.sort((a, b) => a.documentCount - b.documentCount),
      byCourt: courtGaps.sort((a, b) => a.documentCount - b.documentCount),
      byTag: tagGaps.sort((a, b) => a.documentCount - b.documentCount),
    };
  }

  async getStalenessReport(staleDays = 30) {
    const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

    const sources = await this.prisma.source.findMany({
      select: {
        id: true,
        name: true,
        type: true,
        enabled: true,
        _count: { select: { legalDocuments: true } },
        endpoints: {
          select: { lastFetchedAt: true },
          orderBy: { lastFetchedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });

    return sources
      .map((s) => {
        const lastFetched = s.endpoints[0]?.lastFetchedAt ?? null;
        const daysSinceLastFetch = lastFetched
          ? Math.floor((Date.now() - lastFetched.getTime()) / (24 * 60 * 60 * 1000))
          : null;

        return {
          sourceId: s.id,
          sourceName: s.name,
          type: s.type,
          enabled: s.enabled,
          lastFetchedAt: lastFetched?.toISOString() ?? null,
          daysSinceLastFetch,
          documentCount: s._count.legalDocuments,
        };
      })
      .filter((s) => s.lastFetchedAt === null || (s.daysSinceLastFetch !== null && s.daysSinceLastFetch >= staleDays));
  }

  // ---- Enhanced Coverage Gap Analysis ----

  async getEnhancedCoverageGapAnalysis(dto: CoverageGapQueryDto) {
    const dimensions = dto.dimension
      ? [dto.dimension]
      : ['documentType', 'court', 'tag', 'barSubject'] as const;

    const statusFilter: { isPublished?: boolean; status?: string } = {};
    if (dto.status === 'published') statusFilter.isPublished = true;
    else if (dto.status === 'draft') statusFilter.status = 'draft';

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (dto.dateFrom) dateFilter.gte = new Date(dto.dateFrom);
    if (dto.dateTo) dateFilter.lte = new Date(dto.dateTo);
    const hasDateFilter = dto.dateFrom || dto.dateTo;

    type GapItem = { dimension: string; value: string; documentCount: number; latestDate: string | null; staleDays: number | null; gapScore: number };
    const results: Record<string, GapItem[]> = {};

    for (const dim of dimensions) {
      if (dim === 'documentType') {
        const groups = await this.prisma.legalDocument.groupBy({
          by: ['documentType'],
          _count: true,
          _max: { createdAt: true },
          where: {
            ...statusFilter,
            ...(hasDateFilter && { createdAt: dateFilter }),
          },
        });
        results['byDocumentType'] = groups
          .map((g) => {
            const staleDays = g._max.createdAt
              ? Math.floor((Date.now() - g._max.createdAt.getTime()) / (24 * 60 * 60 * 1000))
              : null;
            return {
              dimension: 'documentType',
              value: g.documentType,
              documentCount: g._count,
              latestDate: g._max.createdAt?.toISOString() ?? null,
              staleDays,
              gapScore: this.computeGapScore(g._count, staleDays),
            };
          })
          .filter((g) => !dto.minDocCount || g.documentCount >= dto.minDocCount);
      }

      if (dim === 'court') {
        const groups = await this.prisma.legalDocument.groupBy({
          by: ['court'],
          _count: true,
          _max: { decisionDate: true },
          where: {
            court: { not: null },
            ...statusFilter,
            ...(hasDateFilter && { decisionDate: dateFilter }),
          },
        });
        results['byCourt'] = groups
          .map((g) => {
            const staleDays = g._max.decisionDate
              ? Math.floor((Date.now() - g._max.decisionDate.getTime()) / (24 * 60 * 60 * 1000))
              : null;
            return {
              dimension: 'court',
              value: g.court as string,
              documentCount: g._count,
              latestDate: g._max.decisionDate?.toISOString() ?? null,
              staleDays,
              gapScore: this.computeGapScore(g._count, staleDays),
            };
          })
          .filter((g) => !dto.minDocCount || g.documentCount >= dto.minDocCount);
      }

      if (dim === 'tag') {
        const tagGroups = await this.prisma.legalDocumentTagMap.groupBy({
          by: ['tagId'],
          _count: true,
        });
        const tagIds = tagGroups.map((g) => g.tagId);
        const tags = tagIds.length > 0
          ? await this.prisma.legalMetadataTag.findMany({
              where: { id: { in: tagIds }, tagType: { not: 'bar_subject' } },
              select: { id: true, name: true },
            })
          : [];
        const tagMap = new Map(tags.map((t) => [t.id, t.name]));
        results['byTag'] = tagGroups
          .filter((g) => tagMap.has(g.tagId))
          .map((g) => ({
            dimension: 'tag',
            value: tagMap.get(g.tagId) ?? g.tagId,
            documentCount: g._count,
            latestDate: null,
            staleDays: null,
            gapScore: this.computeGapScore(g._count, null),
          }))
          .filter((g) => !dto.minDocCount || g.documentCount >= dto.minDocCount);
      }

      if (dim === 'barSubject') {
        const barTags = await this.prisma.legalMetadataTag.findMany({
          where: { tagType: 'bar_subject' },
          select: { id: true, name: true, code: true },
        });
        const barTagIds = barTags.map((t) => t.id);
        const barGroups = barTagIds.length > 0
          ? await this.prisma.legalDocumentTagMap.groupBy({
              by: ['tagId'],
              _count: true,
              where: { tagId: { in: barTagIds } },
            })
          : [];
        const barCountMap = new Map(barGroups.map((g) => [g.tagId, g._count]));
        results['byBarSubject'] = barTags.map((t) => ({
          dimension: 'barSubject',
          value: t.name,
          documentCount: barCountMap.get(t.id) ?? 0,
          latestDate: null,
          staleDays: null,
          gapScore: this.computeGapScore(barCountMap.get(t.id) ?? 0, null),
        }));
      }
    }

    // Sort each dimension
    const sortBy = dto.sortBy ?? 'gapScore';
    const sortDir = dto.sortDir ?? 'desc';
    for (const key of Object.keys(results)) {
      const arr = results[key];
      if (!arr) continue;
      arr.sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'gapScore') cmp = a.gapScore - b.gapScore;
        else if (sortBy === 'documentCount') cmp = a.documentCount - b.documentCount;
        else if (sortBy === 'latestDate') cmp = (a.latestDate ?? '').localeCompare(b.latestDate ?? '');
        return sortDir === 'desc' ? -cmp : cmp;
      });
    }

    return results;
  }

  async getBarSubjectCoverage() {
    const barTags = await this.prisma.legalMetadataTag.findMany({
      where: { tagType: 'bar_subject' },
      select: { id: true, name: true, code: true },
    });

    const totalDocuments = await this.prisma.legalDocument.count({
      where: { isPublished: true },
    });

    const barTagIds = barTags.map((t) => t.id);
    const barGroups = barTagIds.length > 0
      ? await this.prisma.legalDocumentTagMap.groupBy({
          by: ['tagId'],
          _count: true,
          where: { tagId: { in: barTagIds } },
        })
      : [];
    const barCountMap = new Map(barGroups.map((g) => [g.tagId, g._count]));

    // Find latest document date per bar subject
    const latestDates = new Map<string, Date>();
    for (const tag of barTags) {
      const latest = await this.prisma.legalDocumentTagMap.findFirst({
        where: { tagId: tag.id },
        include: { legalDocument: { select: { createdAt: true } } },
        orderBy: { legalDocument: { createdAt: 'desc' } },
      });
      if (latest?.legalDocument?.createdAt) {
        latestDates.set(tag.id, latest.legalDocument.createdAt);
      }
    }

    // Coverage score: ratio of tagged docs for this subject vs average expected
    const avgDocsPerSubject = barTags.length > 0 ? totalDocuments / barTags.length : 1;

    return barTags.map((t) => {
      const count = barCountMap.get(t.id) ?? 0;
      const coverageScore = avgDocsPerSubject > 0
        ? Math.min(1, Math.round((count / avgDocsPerSubject) * 100) / 100)
        : 0;
      const latest = latestDates.get(t.id);
      return {
        subject: t.name,
        code: t.code,
        documentCount: count,
        latestDate: latest?.toISOString() ?? null,
        coverageScore,
      };
    }).sort((a, b) => a.coverageScore - b.coverageScore);
  }

  async getIngestionTrends(dto: IngestionTrendsQueryDto) {
    const interval = dto.interval ?? 'day';
    const periods = dto.periods ?? 30;

    // Map interval to PostgreSQL date_trunc argument
    const truncArg = interval === 'week' ? 'week' : interval === 'month' ? 'month' : 'day';

    // Build where conditions
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    // Lookback window
    const lookbackMs = periods * (
      interval === 'month' ? 30 * 24 * 60 * 60 * 1000 :
      interval === 'week' ? 7 * 24 * 60 * 60 * 1000 :
      24 * 60 * 60 * 1000
    );
    const cutoff = new Date(Date.now() - lookbackMs);
    conditions.push(`created_at >= $${paramIdx}`);
    params.push(cutoff);
    paramIdx++;

    if (dto.documentType) {
      conditions.push(`document_type = $${paramIdx}`);
      params.push(dto.documentType);
      paramIdx++;
    }
    if (dto.sourceId) {
      conditions.push(`source_id = $${paramIdx}::uuid`);
      params.push(dto.sourceId);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await this.prisma.$queryRawUnsafe<
      { period: Date; doc_count: bigint }[]
    >(
      `SELECT date_trunc('${truncArg}', created_at) AS period, COUNT(*) AS doc_count
       FROM legal_documents
       ${whereClause}
       GROUP BY period
       ORDER BY period ASC`,
      ...params,
    );

    let cumulative = 0;
    return rows.map((r) => {
      const count = Number(r.doc_count);
      cumulative += count;
      const periodDate = new Date(r.period);
      return {
        period: periodDate.toISOString(),
        periodLabel: this.formatPeriodLabel(periodDate, interval),
        documentCount: count,
        cumulativeCount: cumulative,
      };
    });
  }

  async getSourceLevelGapDrilldown(sourceId: string) {
    await this.assertSourceExists(sourceId);

    const source = await this.prisma.source.findUniqueOrThrow({
      where: { id: sourceId },
      select: {
        id: true,
        name: true,
        healthScore: true,
        _count: { select: { legalDocuments: true } },
        endpoints: {
          select: { lastFetchedAt: true },
          orderBy: { lastFetchedAt: 'desc' },
          take: 1,
        },
      },
    });

    const byType = await this.prisma.legalDocument.groupBy({
      by: ['documentType'],
      _count: true,
      where: { sourceId },
    });

    const byCourt = await this.prisma.legalDocument.groupBy({
      by: ['court'],
      _count: true,
      where: { sourceId, court: { not: null } },
    });

    return {
      sourceId: source.id,
      sourceName: source.name,
      healthScore: source.healthScore,
      byDocumentType: byType.map((g) => ({
        documentType: g.documentType,
        count: g._count,
      })),
      byCourt: byCourt.map((g) => ({
        court: g.court as string,
        count: g._count,
      })),
      lastFetchedAt: source.endpoints[0]?.lastFetchedAt?.toISOString() ?? null,
      totalDocuments: source._count.legalDocuments,
    };
  }

  async exportCoverageGaps(dto: CoverageGapQueryDto, format: 'csv' | 'json') {
    const data = await this.getEnhancedCoverageGapAnalysis(dto);

    // Flatten all dimensions into a single array
    const allItems: { dimension: string; value: string; documentCount: number; latestDate: string | null; staleDays: number | null; gapScore: number }[] = [];
    for (const [, items] of Object.entries(data)) {
      allItems.push(...(items as typeof allItems));
    }

    if (format === 'json') {
      return { contentType: 'application/json', data: JSON.stringify(allItems, null, 2) };
    }

    // CSV format
    const header = 'dimension,value,documentCount,latestDate,staleDays,gapScore';
    const rows = allItems.map((item) =>
      [
        item.dimension,
        `"${(item.value ?? '').replace(/"/g, '""')}"`,
        item.documentCount,
        item.latestDate ?? '',
        item.staleDays ?? '',
        item.gapScore,
      ].join(','),
    );
    return { contentType: 'text/csv', data: [header, ...rows].join('\n') };
  }

  // ---- Ingestion Pipeline Dashboard ----

  async getIngestionPipelineStats(period?: string) {
    const now = new Date();
    let dateFrom: Date | undefined;

    if (period === 'today') {
      dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
      dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const dateFilter = dateFrom ? { startedAt: { gte: dateFrom } } : {};

    const [totalJobs, completedJobs, failedJobs, allJobs, documentsCreated, endpointCount] =
      await Promise.all([
        this.prisma.ingestionJob.count({ where: dateFilter }),
        this.prisma.ingestionJob.count({
          where: { ...dateFilter, status: 'completed' },
        }),
        this.prisma.ingestionJob.count({
          where: { ...dateFilter, status: 'failed' },
        }),
        this.prisma.ingestionJob.findMany({
          where: { ...dateFilter, status: 'completed', durationMs: { not: null } },
          select: { durationMs: true, recordsCreated: true, recordsDuplicate: true, recordsSkipped: true },
        }),
        this.prisma.legalDocument.count({
          where: dateFrom ? { createdAt: { gte: dateFrom } } : {},
        }),
        this.prisma.sourceEndpoint.count({ where: { status: 'active' } }),
      ]);

    const avgDurationMs =
      allJobs.length > 0
        ? Math.round(
            allJobs.reduce((sum, j) => sum + (j.durationMs ?? 0), 0) / allJobs.length,
          )
        : null;

    const totalCreated = allJobs.reduce((sum, j) => sum + (j.recordsCreated ?? 0), 0);
    const totalDuplicate = allJobs.reduce((sum, j) => sum + (j.recordsDuplicate ?? 0), 0);
    const totalSkipped = allJobs.reduce((sum, j) => sum + (j.recordsSkipped ?? 0), 0);

    return {
      totalJobs,
      completedJobs,
      failedJobs,
      successRate: totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : null,
      avgDurationMs,
      documentsCreated,
      documentsSkipped: totalSkipped,
      documentsDuplicate: totalDuplicate,
      documentsIngested: totalCreated,
      activeEndpoints: endpointCount,
    };
  }

  async getIngestionJobHistory(query: IngestionJobHistoryQueryDto) {
    const limit = query.limit ?? 20;
    const where: Record<string, unknown> = {};

    if (query.sourceId) where['sourceId'] = query.sourceId;
    if (query.status) where['status'] = query.status;
    if (query.triggerType) where['triggerType'] = query.triggerType;

    const jobs = await this.prisma.ingestionJob.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { startedAt: 'desc' },
      include: {
        source: { select: { id: true, name: true, type: true } },
        sourceEndpoint: { select: { id: true, endpointUrl: true, parserType: true } },
      },
    });

    const hasNext = jobs.length > limit;
    const items = hasNext ? jobs.slice(0, limit) : jobs;
    const lastItem = items[items.length - 1];

    return {
      items,
      meta: {
        hasNext,
        nextCursor: hasNext && lastItem ? lastItem.id : undefined,
        limit,
      },
    };
  }

  async getIngestionCandidatesByJob(jobId: string, cursor?: string, limit = 20) {
    const job = await this.prisma.ingestionJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Ingestion job not found');

    const candidates = await this.prisma.ingestionCandidate.findMany({
      where: { ingestionJobId: jobId },
      take: limit + 1,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        matchedDocument: {
          select: { id: true, title: true, citationText: true, grNo: true },
        },
      },
    });

    const hasNext = candidates.length > limit;
    const items = hasNext ? candidates.slice(0, limit) : candidates;
    const lastItem = items[items.length - 1];

    return {
      items,
      meta: {
        hasNext,
        nextCursor: hasNext && lastItem ? lastItem.id : undefined,
        limit,
      },
    };
  }

  async getSourceEndpointStatus() {
    const endpoints = await this.prisma.sourceEndpoint.findMany({
      orderBy: [{ status: 'asc' }, { lastFetchedAt: 'desc' }],
      include: {
        source: { select: { id: true, name: true, type: true, enabled: true } },
        ingestionJobs: {
          take: 5,
          orderBy: { startedAt: 'desc' },
          select: {
            id: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            recordsFound: true,
            recordsCreated: true,
            durationMs: true,
          },
        },
      },
    });

    return endpoints.map((ep) => {
      const recentJobs = ep.ingestionJobs;
      const successfulJobs = recentJobs.filter((j) => j.status === 'completed');
      const fetchSuccessRate =
        recentJobs.length > 0
          ? Math.round((successfulJobs.length / recentJobs.length) * 100)
          : null;

      return {
        id: ep.id,
        endpointUrl: ep.endpointUrl,
        parserType: ep.parserType,
        contentTypeHint: ep.contentTypeHint,
        scheduleCron: ep.scheduleCron,
        status: ep.status,
        lastFetchedAt: ep.lastFetchedAt,
        lastSuccessAt: ep.lastSuccessAt,
        source: ep.source,
        fetchSuccessRate,
        recentJobs,
      };
    });
  }

  // ---- Gap Score Computation ----

  private computeGapScore(documentCount: number, staleDays: number | null): number {
    // Lower document count and higher staleness = higher gap score (priority)
    // Score from 0 (no gap) to 1 (critical gap)
    const countScore = Math.max(0, 1 - documentCount / 1000); // fewer docs = higher score
    const stalenessScore = staleDays !== null ? Math.min(1, staleDays / 365) : 0.5;
    const score = countScore * 0.6 + stalenessScore * 0.4;
    return Math.round(score * 100) / 100;
  }

  private formatPeriodLabel(date: Date, interval: string): string {
    if (interval === 'month') {
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    }
    if (interval === 'week') {
      return `Week of ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ---- Helpers ----

  private async assertSourceExists(id: string): Promise<void> {
    const count = await this.prisma.source.count({ where: { id } });
    if (count === 0) {
      throw new NotFoundException('Source not found');
    }
  }

  private async assertEndpointExists(endpointId: string, sourceId: string): Promise<void> {
    const count = await this.prisma.sourceEndpoint.count({
      where: { id: endpointId, sourceId },
    });
    if (count === 0) {
      throw new NotFoundException('Source endpoint not found');
    }
  }
}
