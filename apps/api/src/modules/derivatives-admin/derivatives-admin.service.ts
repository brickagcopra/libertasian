import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AiSettingsService } from '../ai-settings/ai-settings.service';
import {
  ENQUEUEABLE_DERIVATIVE_TYPES,
  EnqueueGenerationDto,
  ListDerivativeJobsDto,
  UpdateDerivativeSettingsDto,
} from './dto';

const DERIVATIVE_TYPES = ENQUEUEABLE_DERIVATIVE_TYPES;

/** Hard-coded average cost per derivative type (USD) for estimation. */
const DEFAULT_COST_PER_TYPE: Record<string, number> = {
  case_digest: 0.08,
  doctrine_extract: 0.04,
  mcq_question: 0.05,
  essay_prompt: 0.06,
  flashcard: 0.03,
  subject_outline: 0.07,
};

@Injectable()
export class DerivativesAdminService {
  private readonly logger = new Logger(DerivativesAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiSettings: AiSettingsService,
    private readonly audit: AuditService,
  ) {}

  // ─── Stats ────────────────────────────────────────────────

  async getStats(): Promise<{
    byType: Array<{
      derivativeType: string;
      totalArtifacts: number;
      pendingJobs: number;
      failedJobs: number;
      completedJobs: number;
      spendThisMonth: number;
    }>;
    globalEnabled: boolean;
    typesEnabled: Record<string, boolean>;
  }> {
    // Artifact counts by type (exclude soft-deleted)
    const artifactCounts = await this.prisma.derivativeArtifact.groupBy({
      by: ['derivativeType'],
      _count: { id: true },
      where: { deletedAt: null },
    });

    // Job counts by type + status
    const jobCounts = await this.prisma.derivativeGenerationJob.groupBy({
      by: ['derivativeType', 'status'],
      _count: { id: true },
    });

    // Current month spend by scope from budget ledger
    const now = new Date();
    const periodYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const ledgerEntries = await this.prisma.budgetLedger.groupBy({
      by: ['scope'],
      _sum: { amountUsd: true },
      where: {
        periodYearMonth,
        scope: { startsWith: 'derivative_type:' },
      },
    });

    // Read settings
    const settings = await this.getDerivativeSettings();

    // Build per-type stats
    const byType = DERIVATIVE_TYPES.map((dt) => {
      const artifacts = artifactCounts.find((a) => a.derivativeType === dt);
      const jobs = jobCounts.filter((j) => j.derivativeType === dt);
      const spend = ledgerEntries.find((l) => l.scope === `derivative_type:${dt}`);

      return {
        derivativeType: dt,
        totalArtifacts: artifacts?._count.id ?? 0,
        pendingJobs: jobs.find((j) => j.status === 'pending')?._count.id ?? 0,
        failedJobs: jobs.find((j) => j.status === 'failed')?._count.id ?? 0,
        completedJobs: jobs.find((j) => j.status === 'completed')?._count.id ?? 0,
        spendThisMonth: spend?._sum.amountUsd
          ? Number(spend._sum.amountUsd)
          : 0,
      };
    });

    return {
      byType,
      globalEnabled: settings.enabled,
      typesEnabled: settings.typesEnabled,
    };
  }

  // ─── Job listing ──────────────────────────────────────────

  async getJobs(params: ListDerivativeJobsDto): Promise<{
    data: unknown[];
    total: number;
  }> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.DerivativeGenerationJobWhereInput = {};
    if (params.derivativeType) where.derivativeType = params.derivativeType;
    if (params.status) where.status = params.status;

    const [data, total] = await Promise.all([
      this.prisma.derivativeGenerationJob.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          sourceDocument: { select: { id: true, title: true } },
        },
      }),
      this.prisma.derivativeGenerationJob.count({ where }),
    ]);

    return { data, total };
  }

  async getJobDigest(jobId: string): Promise<{
    jobStatus: string;
    digest: unknown | null;
  }> {
    const job = await this.prisma.derivativeGenerationJob.findUnique({
      where: { id: jobId },
      select: { id: true, derivativeType: true, status: true },
    });

    if (!job) {
      throw new NotFoundException(`DerivativeGenerationJob ${jobId} not found`);
    }

    if (job.derivativeType !== 'case_digest') {
      throw new BadRequestException(
        `Job type ${job.derivativeType} does not produce a digest artifact`,
      );
    }

    // CARVE-OUT: admin jobId-based digest lookup is cross-tenant by design
    const digest = await this.prisma.digest.findFirst({
      where: { derivativeGenerationJobId: jobId },
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            grNo: true,
            court: true,
            decisionDate: true,
            documentType: true,
            ponente: true,
          },
        },
        reviews: {
          select: {
            id: true,
            verdict: true,
            notes: true,
            truthfulnessScore: true,
            completenessScore: true,
            citationAccuracyScore: true,
            createdAt: true,
            reviewer: {
              select: { id: true, fullName: true },
            },
          },
          orderBy: { createdAt: 'desc' as const },
        },
        derivativeGenerationJob: {
          select: {
            id: true,
            derivativeType: true,
            modelName: true,
            promptTemplateVersion: true,
            startedAt: true,
            finishedAt: true,
            tokensIn: true,
            tokensOut: true,
            estimatedCostUsd: true,
          },
        },
        _count: {
          select: {
            doctrineExtracts: true,
            editorialFlags: true,
          },
        },
      },
    });

    if (!digest) {
      return { jobStatus: job.status, digest: null };
    }

    return { jobStatus: job.status, digest };
  }

  async getJobDoctrines(jobId: string): Promise<{
    jobStatus: string;
    doctrines: unknown[];
  }> {
    const job = await this.prisma.derivativeGenerationJob.findUnique({
      where: { id: jobId },
      select: { id: true, derivativeType: true, status: true, sourceDocumentId: true },
    });

    if (!job) {
      throw new NotFoundException(`DerivativeGenerationJob ${jobId} not found`);
    }

    if (job.derivativeType !== 'doctrine_extract') {
      throw new BadRequestException(
        `Job type ${job.derivativeType} does not produce doctrine extracts`,
      );
    }

    if (!job.sourceDocumentId) {
      return { jobStatus: job.status, doctrines: [] };
    }

    const doctrines = await this.prisma.doctrineExtract.findMany({
      where: { legalDocumentId: job.sourceDocumentId },
      select: {
        id: true,
        text: true,
        doctrineType: true,
        confidence: true,
        reviewStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { jobStatus: job.status, doctrines };
  }

  async getJobEssay(jobId: string): Promise<{
    jobStatus: string;
    essay: unknown | null;
  }> {
    const job = await this.prisma.derivativeGenerationJob.findUnique({
      where: { id: jobId },
      select: { id: true, derivativeType: true, status: true },
    });

    if (!job) {
      throw new NotFoundException(`DerivativeGenerationJob ${jobId} not found`);
    }

    if (job.derivativeType !== 'essay_prompt') {
      throw new BadRequestException(
        `Job type ${job.derivativeType} does not produce an essay prompt artifact`,
      );
    }

    const artifact = await this.prisma.derivativeArtifact.findFirst({
      where: {
        derivativeGenerationJobId: jobId,
        derivativeType: 'essay_prompt',
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        essayPrompt: true,
        contentDisclaimer: { select: { id: true, bodyPlain: true } },
      },
    });

    if (!artifact) {
      return { jobStatus: job.status, essay: null };
    }

    return { jobStatus: job.status, essay: artifact };
  }

  async getJobMcqs(jobId: string): Promise<{
    jobStatus: string;
    mcqs: unknown[];
  }> {
    const job = await this.prisma.derivativeGenerationJob.findUnique({
      where: { id: jobId },
      select: { id: true, derivativeType: true, status: true },
    });

    if (!job) {
      throw new NotFoundException(`DerivativeGenerationJob ${jobId} not found`);
    }

    if (job.derivativeType !== 'mcq_question') {
      throw new BadRequestException(
        `Job type ${job.derivativeType} does not produce an MCQ artifact`,
      );
    }

    const artifacts = await this.prisma.derivativeArtifact.findMany({
      where: {
        derivativeGenerationJobId: jobId,
        derivativeType: 'mcq_question',
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        reviewStatus: true,
        visibility: true,
        confidenceScore: true,
        validatorVerdict: true,
        publishedAt: true,
        createdAt: true,
        contentDisclaimer: { select: { id: true, bodyPlain: true } },
        mcqQuestion: {
          select: {
            questionStem: true,
            explanation: true,
            difficulty: true,
            questionFormat: true,
            options: {
              orderBy: { optionLabel: 'asc' },
              select: {
                optionLabel: true,
                optionText: true,
                isCorrect: true,
                rationale: true,
              },
            },
          },
        },
      },
    });

    const mcqs = artifacts.map((a) => ({
      id: a.id,
      title: a.title,
      reviewStatus: a.reviewStatus,
      visibility: a.visibility,
      confidenceScore: a.confidenceScore,
      validatorVerdict: a.validatorVerdict,
      publishedAt: a.publishedAt,
      createdAt: a.createdAt,
      contentDisclaimer: a.contentDisclaimer,
      mcqQuestion: a.mcqQuestion
        ? {
            questionStem: a.mcqQuestion.questionStem,
            explanation: a.mcqQuestion.explanation,
            difficulty: a.mcqQuestion.difficulty,
            questionFormat: a.mcqQuestion.questionFormat,
            options: a.mcqQuestion.options.map((o) => ({
              optionLetter: o.optionLabel,
              text: o.optionText,
              isCorrect: o.isCorrect,
              rationale: o.rationale,
            })),
          }
        : null,
    }));

    return { jobStatus: job.status, mcqs };
  }

  async getJobFlashcards(jobId: string): Promise<{
    jobStatus: string;
    flashcards: unknown[];
  }> {
    const job = await this.prisma.derivativeGenerationJob.findUnique({
      where: { id: jobId },
      select: { id: true, derivativeType: true, status: true },
    });

    if (!job) {
      throw new NotFoundException(`DerivativeGenerationJob ${jobId} not found`);
    }

    if (job.derivativeType !== 'flashcard') {
      throw new BadRequestException(
        `Job type ${job.derivativeType} does not produce a flashcard artifact`,
      );
    }

    const artifacts = await this.prisma.derivativeArtifact.findMany({
      where: {
        derivativeGenerationJobId: jobId,
        derivativeType: 'flashcard',
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        reviewStatus: true,
        visibility: true,
        confidenceScore: true,
        validatorVerdict: true,
        publishedAt: true,
        createdAt: true,
        contentJson: true,
        contentDisclaimer: { select: { id: true, bodyPlain: true } },
      },
    });

    return { jobStatus: job.status, flashcards: artifacts };
  }

  async getJobOutlines(jobId: string): Promise<{
    jobStatus: string;
    outlines: unknown[];
  }> {
    const job = await this.prisma.derivativeGenerationJob.findUnique({
      where: { id: jobId },
      select: { id: true, derivativeType: true, status: true },
    });

    if (!job) {
      throw new NotFoundException(`DerivativeGenerationJob ${jobId} not found`);
    }

    if (job.derivativeType !== 'subject_outline') {
      throw new BadRequestException(
        `Job type ${job.derivativeType} does not produce a subject_outline artifact`,
      );
    }

    const artifacts = await this.prisma.derivativeArtifact.findMany({
      where: {
        derivativeGenerationJobId: jobId,
        derivativeType: 'subject_outline',
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        reviewStatus: true,
        visibility: true,
        confidenceScore: true,
        validatorVerdict: true,
        publishedAt: true,
        createdAt: true,
        contentJson: true,
        contentDisclaimer: { select: { id: true, bodyPlain: true } },
      },
    });

    return { jobStatus: job.status, outlines: artifacts };
  }

  async getJob(id: string): Promise<unknown> {
    const job = await this.prisma.derivativeGenerationJob.findUnique({
      where: { id },
      include: {
        sourceDocument: { select: { id: true, title: true, citationText: true } },
        derivativeArtifacts: {
          where: { deletedAt: null },
          select: { id: true, derivativeType: true, title: true, reviewStatus: true },
        },
      },
    });

    if (!job) {
      throw new NotFoundException(`DerivativeGenerationJob ${id} not found`);
    }

    return job;
  }

  // ─── Generation controls ──────────────────────────────────

  async enqueueGeneration(
    dto: EnqueueGenerationDto,
    userId: string,
  ): Promise<{
    enqueuedCount: number;
    estimatedCostUsd: number;
    jobIds: string[];
  }> {
    // 1. Validate derivativeType is enabled
    const settings = await this.getDerivativeSettings();
    if (!settings.enabled) {
      throw new BadRequestException('Derivative generation is globally disabled');
    }
    if (!settings.typesEnabled[dto.derivativeType]) {
      throw new BadRequestException(
        `Derivative type "${dto.derivativeType}" is disabled`,
      );
    }

    // Subject-outline dispatches per subject, not per document. Each job
    // synthesises across multiple docs classified under the subject, so
    // the per-doc fan-out below would create jobs that fail the
    // ≥3 sections + ≥2 cited docs invariant (190/206 outline jobs
    // failed in the 2026-04-22 bulk-gen because of this).
    if (dto.derivativeType === 'subject_outline') {
      return this.enqueueSubjectOutlineGeneration(dto, userId);
    }

    // 2. Query matching documents
    const docWhere: Prisma.LegalDocumentWhereInput = {};
    if (dto.sourceId) docWhere.sourceId = dto.sourceId;
    if (dto.court) docWhere.court = dto.court;
    if (dto.dateFrom || dto.dateTo) {
      docWhere.decisionDate = {};
      if (dto.dateFrom) docWhere.decisionDate.gte = new Date(dto.dateFrom);
      if (dto.dateTo) docWhere.decisionDate.lte = new Date(dto.dateTo);
    }

    // 3. Exclude documents that already have an artifact of this type
    if (!dto.regenerateExisting) {
      const existingDocIds = await this.prisma.derivativeArtifact.findMany({
        where: {
          derivativeType: dto.derivativeType,
          deletedAt: null,
        },
        select: { sourceDocumentId: true },
      });
      const excludeIds = existingDocIds
        .map((a) => a.sourceDocumentId)
        .filter((id): id is string => id !== null);
      if (excludeIds.length > 0) {
        docWhere.id = { notIn: excludeIds };
      }
    }

    // 4. Limit to maxCount
    const maxCount = dto.maxCount ?? 50;
    const documents = await this.prisma.legalDocument.findMany({
      where: docWhere,
      select: { id: true },
      take: maxCount,
      orderBy: { createdAt: 'desc' },
    });

    if (documents.length === 0) {
      return { enqueuedCount: 0, estimatedCostUsd: 0, jobIds: [] };
    }

    // 5. Create DerivativeGenerationJob rows in 'pending' status
    const jobIds: string[] = [];
    const costPerUnit = DEFAULT_COST_PER_TYPE[dto.derivativeType] ?? 0.05;

    for (const doc of documents) {
      const job = await this.prisma.derivativeGenerationJob.create({
        data: {
          derivativeType: dto.derivativeType,
          triggerType: 'manual',
          sourceDocumentId: doc.id,
          status: 'pending',
          triggeredByUserId: userId,
        },
      });
      jobIds.push(job.id);
    }

    // 6. Estimate cost
    const estimatedCostUsd = documents.length * costPerUnit;

    // 7. Audit log
    await this.audit.log({
      actorUserId: userId,
      actorType: 'admin',
      action: 'derivatives_admin.enqueue_generation',
      entityType: 'derivative_generation_job',
      entityId: jobIds[0],
      metadata: {
        derivativeType: dto.derivativeType,
        enqueuedCount: documents.length,
        estimatedCostUsd,
      },
    });

    return {
      enqueuedCount: documents.length,
      estimatedCostUsd,
      jobIds,
    };
  }

  private async enqueueSubjectOutlineGeneration(
    dto: EnqueueGenerationDto,
    userId: string,
  ): Promise<{
    enqueuedCount: number;
    estimatedCostUsd: number;
    jobIds: string[];
  }> {
    // One outline job per distinct primary subject. When
    // `dto.subjectCode` is provided, dispatch only for that subject.
    // Taxonomy is pinned to `study_8` to match the worker's
    // _resolve_primary_subject / _get_document_ids_by_subject queries.
    const subjectWhere: Prisma.SubjectWhereInput = {
      taxonomyVersion: 'study_8',
      documentAssignments: { some: { isPrimary: true } },
    };
    if (dto.subjectCode) {
      subjectWhere.code = dto.subjectCode;
    }

    const subjects = await this.prisma.subject.findMany({
      where: subjectWhere,
      select: { code: true },
      orderBy: { code: 'asc' },
    });

    if (subjects.length === 0) {
      return { enqueuedCount: 0, estimatedCostUsd: 0, jobIds: [] };
    }

    const maxCount = dto.maxCount ?? 50;
    const selected = subjects.slice(0, maxCount);

    const jobIds: string[] = [];
    const costPerUnit = DEFAULT_COST_PER_TYPE['subject_outline'] ?? 0.07;

    for (const subj of selected) {
      const job = await this.prisma.derivativeGenerationJob.create({
        data: {
          derivativeType: 'subject_outline',
          triggerType: 'manual',
          sourceDocumentId: null,
          subjectCode: subj.code,
          status: 'pending',
          triggeredByUserId: userId,
        },
      });
      jobIds.push(job.id);
    }

    const estimatedCostUsd = selected.length * costPerUnit;

    await this.audit.log({
      actorUserId: userId,
      actorType: 'admin',
      action: 'derivatives_admin.enqueue_generation',
      entityType: 'derivative_generation_job',
      entityId: jobIds[0],
      metadata: {
        derivativeType: 'subject_outline',
        dispatchMode: 'per_subject',
        enqueuedCount: selected.length,
        subjectCodes: selected.map((s) => s.code),
        estimatedCostUsd,
      },
    });

    return {
      enqueuedCount: selected.length,
      estimatedCostUsd,
      jobIds,
    };
  }

  async retryJob(jobId: string, userId: string): Promise<void> {
    const job = await this.prisma.derivativeGenerationJob.findUnique({
      where: { id: jobId },
      select: { id: true, status: true },
    });

    if (!job) {
      throw new NotFoundException(`DerivativeGenerationJob ${jobId} not found`);
    }

    if (job.status !== 'failed') {
      throw new BadRequestException(
        `Cannot retry job with status "${job.status}" — only failed jobs can be retried`,
      );
    }

    await this.prisma.derivativeGenerationJob.update({
      where: { id: jobId },
      data: {
        status: 'pending',
        errorJson: Prisma.JsonNull,
        startedAt: null,
        finishedAt: null,
      },
    });

    await this.audit.log({
      actorUserId: userId,
      actorType: 'admin',
      action: 'derivatives_admin.retry_job',
      entityType: 'derivative_generation_job',
      entityId: jobId,
      metadata: {},
    });
  }

  async regenerateArtifact(
    artifactId: string,
    userId: string,
  ): Promise<{ jobId: string }> {
    const artifact = await this.prisma.derivativeArtifact.findUnique({
      where: { id: artifactId },
      select: {
        id: true,
        derivativeType: true,
        sourceDocumentId: true,
        deletedAt: true,
      },
    });

    if (!artifact) {
      throw new NotFoundException(`DerivativeArtifact ${artifactId} not found`);
    }

    if (artifact.deletedAt) {
      throw new BadRequestException('Artifact is already soft-deleted');
    }

    // Soft-delete the existing artifact
    await this.prisma.derivativeArtifact.update({
      where: { id: artifactId },
      data: { deletedAt: new Date() },
    });

    // Create a new pending job
    const job = await this.prisma.derivativeGenerationJob.create({
      data: {
        derivativeType: artifact.derivativeType,
        triggerType: 'manual',
        sourceDocumentId: artifact.sourceDocumentId,
        status: 'pending',
        triggeredByUserId: userId,
      },
    });

    await this.audit.log({
      actorUserId: userId,
      actorType: 'admin',
      action: 'derivatives_admin.regenerate_artifact',
      entityType: 'derivative_artifact',
      entityId: artifactId,
      metadata: {
        newJobId: job.id,
        derivativeType: artifact.derivativeType,
      },
    });

    return { jobId: job.id };
  }

  async softDeleteArtifact(artifactId: string, userId: string): Promise<void> {
    const artifact = await this.prisma.derivativeArtifact.findUnique({
      where: { id: artifactId },
      select: { id: true, derivativeType: true, deletedAt: true },
    });

    if (!artifact) {
      throw new NotFoundException(`DerivativeArtifact ${artifactId} not found`);
    }

    if (artifact.deletedAt) {
      throw new BadRequestException('Artifact is already soft-deleted');
    }

    await this.prisma.derivativeArtifact.update({
      where: { id: artifactId },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      actorUserId: userId,
      actorType: 'admin',
      action: 'derivatives_admin.soft_delete_artifact',
      entityType: 'derivative_artifact',
      entityId: artifactId,
      metadata: { derivativeType: artifact.derivativeType },
    });
  }

  async deleteJobOutput(jobId: string, userId: string): Promise<void> {
    const job = await this.prisma.derivativeGenerationJob.findUnique({
      where: { id: jobId },
      select: { id: true, derivativeType: true, status: true },
    });

    if (!job) {
      throw new NotFoundException(`DerivativeGenerationJob ${jobId} not found`);
    }

    if (job.derivativeType === 'case_digest') {
      // CARVE-OUT: admin delete is cross-tenant by design
      const digest = await this.prisma.digest.findFirst({
        where: { derivativeGenerationJobId: jobId },
      });

      if (!digest) {
        // No output — delete the job record itself (e.g. failed jobs)
        await this.prisma.derivativeGenerationJob.delete({ where: { id: jobId } });
        await this.audit.log({
          actorUserId: userId,
          actorType: 'admin',
          action: 'derivative_job.admin_delete',
          entityType: 'derivative_generation_job',
          entityId: jobId,
          metadata: { derivativeType: job.derivativeType, status: job.status, reason: 'no_output' },
        });
        return;
      }

      // Digest model has no deletedAt — hard delete (admin reviewer rejection;
      // the source of truth is the legal_document).
      // CARVE-OUT: admin delete is cross-tenant by design
      await this.prisma.digest.delete({ where: { id: digest.id } });
      await this.prisma.derivativeGenerationJob.delete({ where: { id: jobId } });

      await this.audit.log({
        actorUserId: userId,
        actorType: 'admin',
        action: 'digest.admin_delete',
        entityType: 'digest',
        entityId: digest.id,
        metadata: {
          derivativeGenerationJobId: jobId,
          derivativeType: job.derivativeType,
        },
      });
      return;
    }

    // For other derivative types, fall through to existing artifact logic
    const artifact = await this.prisma.derivativeArtifact.findFirst({
      where: {
        derivativeGenerationJobId: jobId,
        deletedAt: null,
      },
    });

    if (!artifact) {
      // No output — delete the job record itself (e.g. failed jobs)
      await this.prisma.derivativeGenerationJob.delete({ where: { id: jobId } });
      await this.audit.log({
        actorUserId: userId,
        actorType: 'admin',
        action: 'derivative_job.admin_delete',
        entityType: 'derivative_generation_job',
        entityId: jobId,
        metadata: { derivativeType: job.derivativeType, status: job.status, reason: 'no_output' },
      });
      return;
    }

    await this.softDeleteArtifact(artifact.id, userId);
    await this.prisma.derivativeGenerationJob.delete({ where: { id: jobId } });
  }

  // ─── Settings ─────────────────────────────────────────────

  async getDerivativeSettings(): Promise<{
    enabled: boolean;
    typesEnabled: Record<string, boolean>;
  }> {
    const enabledRow = await this.aiSettings.getSetting(
      'derivative_generation.enabled',
    );
    const typesRow = await this.aiSettings.getSetting(
      'derivative_generation.types_enabled',
    );

    const enabledValue = enabledRow?.value as Record<string, unknown> | null;
    const enabled = enabledValue?.['enabled'] === true;

    const defaultTypes: Record<string, boolean> = {};
    for (const dt of DERIVATIVE_TYPES) {
      defaultTypes[dt] = true;
    }

    const typesValue = typesRow?.value;
    const typesEnabled =
      typesValue && typeof typesValue === 'object'
        ? { ...defaultTypes, ...(typesValue as Record<string, boolean>) }
        : defaultTypes;

    return { enabled, typesEnabled };
  }

  async updateDerivativeSettings(
    dto: UpdateDerivativeSettingsDto,
    userId: string,
  ): Promise<void> {
    if (dto.enabled !== undefined) {
      await this.aiSettings.updateSetting(
        'derivative_generation.enabled',
        { enabled: dto.enabled },
        userId,
      );
    }

    if (dto.typesEnabled !== undefined) {
      await this.aiSettings.updateSetting(
        'derivative_generation.types_enabled',
        dto.typesEnabled,
        userId,
      );
    }

    await this.audit.log({
      actorUserId: userId,
      actorType: 'admin',
      action: 'derivatives_admin.update_settings',
      entityType: 'ai_settings',
      metadata: {
        entity_key: 'derivative_generation',
        enabled: dto.enabled,
        typesEnabled: dto.typesEnabled,
      },
    });
  }
}
