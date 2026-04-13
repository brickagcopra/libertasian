import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { ClassifyDocumentDto } from './dto';

@Injectable()
export class SubjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all subjects, optionally filtered by taxonomy version.
   */
  async findAllSubjects(taxonomyVersion?: string) {
    return this.prisma.subject.findMany({
      where: taxonomyVersion ? { taxonomyVersion } : undefined,
      orderBy: { displayOrder: 'asc' },
    });
  }

  /**
   * Find a subject by code and taxonomy version.
   */
  async findSubjectByCode(code: string, taxonomyVersion: string) {
    return this.prisma.subject.findUnique({
      where: {
        code_taxonomyVersion: { code, taxonomyVersion },
      },
    });
  }

  /**
   * List all topics under a subject.
   */
  async findTopicsBySubject(subjectId: string) {
    return this.prisma.subjectTopic.findMany({
      where: { subjectId },
      orderBy: { displayOrder: 'asc' },
    });
  }

  /**
   * Get equivalence mappings for a study_8 subject.
   */
  async getEquivalences(studySubjectId: string) {
    return this.prisma.subjectEquivalence.findMany({
      where: { studySubjectId },
      include: { barAdminSubject: true },
    });
  }

  /**
   * Given a bar_admin_6 code, returns the list of study_8 subject IDs
   * that map to it. Used by bar-exam-admin surfaces to filter documents
   * classified under study_8.
   */
  async resolveBarAdminSubjects(barAdminCode: string): Promise<string[]> {
    const barAdminSubject = await this.prisma.subject.findUnique({
      where: {
        code_taxonomyVersion: { code: barAdminCode, taxonomyVersion: 'bar_admin_6' },
      },
    });

    if (!barAdminSubject) {
      return [];
    }

    const equivalences = await this.prisma.subjectEquivalence.findMany({
      where: { barAdminSubjectId: barAdminSubject.id },
      select: { studySubjectId: true },
    });

    return equivalences.map((eq) => eq.studySubjectId);
  }

  /**
   * Get classification coverage stats: total docs, classified docs,
   * unclassified count, and per-subject breakdown.
   */
  async getClassificationCoverage() {
    const totalDocuments = await this.prisma.legalDocument.count();

    const classifiedDocIds = await this.prisma.documentSubjectAssignment.findMany({
      where: { legalDocumentId: { not: null } },
      select: { legalDocumentId: true },
      distinct: ['legalDocumentId'],
    });
    const classifiedDocuments = classifiedDocIds.length;
    const unclassifiedDocuments = totalDocuments - classifiedDocuments;
    const coveragePercent =
      totalDocuments > 0
        ? Math.round((classifiedDocuments / totalDocuments) * 10000) / 100
        : 0;

    // Per-subject breakdown
    const subjects = await this.prisma.subject.findMany({
      where: { taxonomyVersion: 'study_8' },
      orderBy: { displayOrder: 'asc' },
    });

    const bySubject = await Promise.all(
      subjects.map(async (subject) => {
        const documentCount = await this.prisma.documentSubjectAssignment.count({
          where: { subjectId: subject.id, legalDocumentId: { not: null } },
        });
        const primaryCount = await this.prisma.documentSubjectAssignment.count({
          where: {
            subjectId: subject.id,
            legalDocumentId: { not: null },
            isPrimary: true,
          },
        });

        return {
          subjectId: subject.id,
          subjectCode: subject.code,
          subjectName: subject.name,
          documentCount,
          primaryCount,
        };
      }),
    );

    return {
      totalDocuments,
      classifiedDocuments,
      unclassifiedDocuments,
      coveragePercent,
      bySubject,
    };
  }

  /**
   * Create a document subject assignment. Enforces:
   * - At least one of legalDocumentId or derivativeArtifactId must be set
   * - subjectId must exist
   * - If subjectTopicId is set, it must belong to the subject
   */
  async classifyDocument(params: ClassifyDocumentDto) {
    if (!params.legalDocumentId && !params.derivativeArtifactId) {
      throw new BadRequestException(
        'At least one of legalDocumentId or derivativeArtifactId must be provided',
      );
    }

    const subject = await this.prisma.subject.findUnique({
      where: { id: params.subjectId },
    });
    if (!subject) {
      throw new NotFoundException(`Subject ${params.subjectId} not found`);
    }

    if (params.subjectTopicId) {
      const topic = await this.prisma.subjectTopic.findUnique({
        where: { id: params.subjectTopicId },
      });
      if (!topic || topic.subjectId !== params.subjectId) {
        throw new BadRequestException(
          `SubjectTopic ${params.subjectTopicId} does not belong to subject ${params.subjectId}`,
        );
      }
    }

    return this.prisma.documentSubjectAssignment.create({
      data: {
        legalDocumentId: params.legalDocumentId,
        derivativeArtifactId: params.derivativeArtifactId,
        subjectId: params.subjectId,
        subjectTopicId: params.subjectTopicId,
        isPrimary: params.isPrimary,
        confidence: params.confidence,
        classifiedBy: params.classifiedBy ?? 'ai',
        classifierModelRunId: params.classifierModelRunId,
      },
    });
  }
}
