import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateGoldenSetEntryDto,
  UpdateGoldenSetEntryDto,
  ListGoldenSetsQueryDto,
} from './dto';

@Injectable()
export class GoldenSetsService {
  private readonly logger = new Logger(GoldenSetsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---- CRUD ----

  async findAll(query: ListGoldenSetsQueryDto) {
    const where: Prisma.GoldenSetEntryWhereInput = {};
    if (query.type) where.goldenSetType = query.type;
    if (query.status) where.status = query.status;

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const [entries, total] = await Promise.all([
      this.prisma.goldenSetEntry.findMany({
        where,
        include: { sourceDocument: { select: { id: true, title: true, citationText: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.goldenSetEntry.count({ where }),
    ]);

    return { entries, total, page, limit };
  }

  async findOne(id: string) {
    const entry = await this.prisma.goldenSetEntry.findUnique({
      where: { id },
      include: {
        sourceDocument: { select: { id: true, title: true, citationText: true, court: true } },
        reviewedByUser: { select: { id: true, fullName: true } },
      },
    });
    if (!entry) throw new NotFoundException(`GoldenSetEntry ${id} not found`);
    return entry;
  }

  async create(dto: CreateGoldenSetEntryDto) {
    return this.prisma.goldenSetEntry.create({
      data: {
        goldenSetType: dto.goldenSetType,
        sourceDocumentId: dto.sourceDocumentId,
        referenceDataJson: dto.referenceDataJson as Prisma.InputJsonValue,
        status: 'draft',
      },
    });
  }

  async update(id: string, dto: UpdateGoldenSetEntryDto) {
    await this.findOne(id);
    return this.prisma.goldenSetEntry.update({
      where: { id },
      data: {
        ...(dto.referenceDataJson !== undefined && {
          referenceDataJson: dto.referenceDataJson as Prisma.InputJsonValue,
        }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.reviewNotes !== undefined && { reviewNotes: dto.reviewNotes }),
      },
    });
  }

  async remove(id: string) {
    const entry = await this.findOne(id);
    if (entry.status !== 'draft') {
      throw new BadRequestException('Only draft entries can be deleted');
    }
    await this.prisma.goldenSetEntry.delete({ where: { id } });
  }

  // ---- Review workflow ----

  async approve(id: string, userId: string, notes?: string) {
    const entry = await this.findOne(id);
    if (entry.status === 'approved') {
      throw new ConflictException('Entry is already approved');
    }
    return this.prisma.goldenSetEntry.update({
      where: { id },
      data: {
        status: 'approved',
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        reviewNotes: notes ?? entry.reviewNotes,
      },
    });
  }

  async reject(id: string, userId: string, notes: string) {
    await this.findOne(id);
    return this.prisma.goldenSetEntry.update({
      where: { id },
      data: {
        status: 'rejected',
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        reviewNotes: notes,
      },
    });
  }

  async bulkApprove(ids: string[], userId: string) {
    const result = await this.prisma.goldenSetEntry.updateMany({
      where: { id: { in: ids }, status: { not: 'approved' } },
      data: {
        status: 'approved',
        reviewedByUserId: userId,
        reviewedAt: new Date(),
      },
    });
    return { approved: result.count };
  }

  // ---- AI draft generation (stubs) ----

  async generateDraftDigests(count = 20) {
    const docs = await this.prisma.legalDocument.findMany({
      where: {
        documentType: { in: ['case', 'decision', 'resolution', 'en_banc'] },
        status: 'published',
      },
      select: { id: true, title: true },
      orderBy: { createdAt: 'desc' },
      take: count,
    });

    let created = 0;
    for (const doc of docs) {
      await this.prisma.goldenSetEntry.create({
        data: {
          goldenSetType: 'case_digest',
          sourceDocumentId: doc.id,
          referenceDataJson: {},
          status: 'draft',
        },
      });
      created++;
    }

    return { created };
  }

  async generateDraftClassifications(count = 100) {
    const docs = await this.prisma.legalDocument.findMany({
      where: { status: 'published' },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: count,
    });

    let created = 0;
    for (const doc of docs) {
      await this.prisma.goldenSetEntry.create({
        data: {
          goldenSetType: 'subject_classification',
          sourceDocumentId: doc.id,
          referenceDataJson: {},
          status: 'draft',
        },
      });
      created++;
    }

    return { created };
  }

  async sampleMcqGoldenSet(count = 50) {
    const docs = await this.prisma.legalDocument.findMany({
      where: {
        documentType: { in: ['bar_question', 'mcq_question'] },
      },
      select: { id: true },
      take: count,
    });

    let created = 0;
    for (const doc of docs) {
      await this.prisma.goldenSetEntry.create({
        data: {
          goldenSetType: 'mcq_question',
          sourceDocumentId: doc.id,
          referenceDataJson: {},
          status: 'draft',
        },
      });
      created++;
    }

    // If no bar question docs exist, create placeholder entries
    if (created === 0) {
      for (let i = 0; i < Math.min(count, 10); i++) {
        await this.prisma.goldenSetEntry.create({
          data: {
            goldenSetType: 'mcq_question',
            referenceDataJson: { placeholder: true, note: 'Awaiting bar question ingestion' },
            status: 'draft',
          },
        });
        created++;
      }
    }

    return { created };
  }

  // ---- Evaluation ----

  async getEvaluationRuns(type?: string) {
    const where: Prisma.EvaluationRunWhereInput = {};
    if (type) where.goldenSetType = type;

    return this.prisma.evaluationRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getEvaluationRun(id: string) {
    const run = await this.prisma.evaluationRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException(`EvaluationRun ${id} not found`);
    return run;
  }

  // ---- Stats ----

  async getStats() {
    const types = ['case_digest', 'subject_classification', 'mcq_question'] as const;
    const stats: Record<string, { total: number; approved: number; pending: number }> = {};

    for (const type of types) {
      const [total, approved, pending] = await Promise.all([
        this.prisma.goldenSetEntry.count({ where: { goldenSetType: type } }),
        this.prisma.goldenSetEntry.count({ where: { goldenSetType: type, status: 'approved' } }),
        this.prisma.goldenSetEntry.count({
          where: { goldenSetType: type, status: { in: ['draft', 'pending_review'] } },
        }),
      ]);
      stats[type] = { total, approved, pending };
    }

    return {
      caseDigest: stats['case_digest'],
      subjectClassification: stats['subject_classification'],
      mcqQuestion: stats['mcq_question'],
    };
  }
}
