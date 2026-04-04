import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import { KnowledgeGraphService } from './knowledge-graph.service';

describe('KnowledgeGraphService', () => {
  let service: KnowledgeGraphService;
  let prisma: jest.Mocked<PrismaService>;

  const mockNode = {
    id: 'doc-1',
    title: 'People v. Santos',
    shortTitle: 'Santos',
    citationText: 'G.R. No. 123456',
    grNo: '123456',
    documentType: 'case',
    court: 'Supreme Court',
    decisionDate: new Date('2020-01-15'),
  };

  const mockCitation = {
    id: 'cit-1',
    fromDocumentId: 'doc-1',
    toDocumentId: 'doc-2',
    citationText: 'People v. Reyes, G.R. No. 654321',
    citationType: 'case',
    confidence: 0.95,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeGraphService,
        {
          provide: PrismaService,
          useValue: {
            legalDocument: {
              findUnique: jest.fn(),
              findUniqueOrThrow: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
            },
            citation: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              count: jest.fn(),
            },
            caseCodalLink: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
            },
            legalDocumentSection: {
              count: jest.fn(),
            },
            doctrineExtract: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
            },
            modelRun: {
              create: jest.fn(),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://localhost:8000'),
          },
        },
      ],
    }).compile();

    service = module.get<KnowledgeGraphService>(KnowledgeGraphService);
    prisma = module.get(PrismaService);
  });

  // ---- getCites ----

  describe('getCites', () => {
    it('should return outgoing citations for a document', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue(mockNode);
      (prisma.citation.findMany as jest.Mock).mockResolvedValue([mockCitation]);
      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValue([
        { ...mockNode, id: 'doc-2', title: 'People v. Reyes' },
      ]);

      const result = await service.getCites('doc-1');

      expect(result.nodes.length).toBeGreaterThanOrEqual(1);
      expect(result.edges).toHaveLength(1);
    });

    it('should throw NotFoundException for missing document', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(0);

      await expect(service.getCites('doc-x')).rejects.toThrow(NotFoundException);
    });

    it('should cap depth at 3', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue(mockNode);
      (prisma.citation.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getCites('doc-1', 10);
      // Should not error — depth is capped internally
      expect(result.nodes).toHaveLength(1);
    });
  });

  // ---- getCitedBy ----

  describe('getCitedBy', () => {
    it('should return incoming citations for a document', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue(mockNode);
      (prisma.citation.findMany as jest.Mock).mockResolvedValue([
        {
          ...mockCitation,
          id: 'cit-2',
          fromDocumentId: 'doc-3',
          toDocumentId: 'doc-1',
        },
      ]);
      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValue([
        { ...mockNode, id: 'doc-3', title: 'Case C' },
      ]);

      const result = await service.getCitedBy('doc-1');
      expect(result.edges).toHaveLength(1);
    });
  });

  // ---- getChain ----

  describe('getChain', () => {
    it('should merge outgoing and incoming graphs', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue(mockNode);
      (prisma.citation.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getChain('doc-1');
      expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---- getNetwork ----

  describe('getNetwork', () => {
    it('should delegate to getChain', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue(mockNode);
      (prisma.citation.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getNetwork('doc-1', 2);
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('edges');
    });
  });

  // ---- Codal Links ----

  describe('getCodalLinks', () => {
    it('should return codal links as case and as codal', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.caseCodalLink.findMany as jest.Mock)
        .mockResolvedValueOnce([{ id: 'ccl-1' }])   // as case
        .mockResolvedValueOnce([{ id: 'ccl-2' }]);   // as codal

      const result = await service.getCodalLinks('doc-1');
      expect(result.asCase).toHaveLength(1);
      expect(result.asCodal).toHaveLength(1);
    });

    it('should throw NotFoundException for missing document', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(0);

      await expect(service.getCodalLinks('doc-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ---- createCaseCodalLink ----

  describe('createCaseCodalLink', () => {
    it('should create a case-codal link', async () => {
      (prisma.legalDocument.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'doc-1', documentType: 'case' })
        .mockResolvedValueOnce({ id: 'doc-2', documentType: 'statute' });
      (prisma.caseCodalLink.create as jest.Mock).mockResolvedValue({
        id: 'ccl-1',
        caseDocumentId: 'doc-1',
        codalDocumentId: 'doc-2',
        linkType: 'interprets',
      });

      const result = await service.createCaseCodalLink(
        {
          caseDocumentId: 'doc-1',
          codalDocumentId: 'doc-2',
          linkType: 'interprets',
        },
        'user-1',
      );

      expect(result.id).toBe('ccl-1');
    });

    it('should throw NotFoundException for missing case document', async () => {
      (prisma.legalDocument.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'doc-2' });

      await expect(
        service.createCaseCodalLink(
          { caseDocumentId: 'doc-x', codalDocumentId: 'doc-2', linkType: 'interprets' },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for missing codal document', async () => {
      (prisma.legalDocument.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'doc-1' })
        .mockResolvedValueOnce(null);

      await expect(
        service.createCaseCodalLink(
          { caseDocumentId: 'doc-1', codalDocumentId: 'doc-x', linkType: 'interprets' },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for self-link', async () => {
      (prisma.legalDocument.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'doc-1' })
        .mockResolvedValueOnce({ id: 'doc-1' });

      await expect(
        service.createCaseCodalLink(
          { caseDocumentId: 'doc-1', codalDocumentId: 'doc-1', linkType: 'interprets' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should validate section belongs to codal document', async () => {
      (prisma.legalDocument.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'doc-1' })
        .mockResolvedValueOnce({ id: 'doc-2' });
      (prisma.legalDocumentSection.count as jest.Mock).mockResolvedValue(0);

      await expect(
        service.createCaseCodalLink(
          {
            caseDocumentId: 'doc-1',
            codalDocumentId: 'doc-2',
            codalSectionId: 'sec-x',
            linkType: 'interprets',
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- updateCaseCodalLink ----

  describe('updateCaseCodalLink', () => {
    it('should update link fields', async () => {
      (prisma.caseCodalLink.findUnique as jest.Mock).mockResolvedValue({ id: 'ccl-1' });
      (prisma.caseCodalLink.update as jest.Mock).mockResolvedValue({
        id: 'ccl-1',
        notes: 'Updated notes',
      });

      const result = await service.updateCaseCodalLink('ccl-1', { notes: 'Updated notes' });
      expect(result.notes).toBe('Updated notes');
    });

    it('should throw NotFoundException for missing link', async () => {
      (prisma.caseCodalLink.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateCaseCodalLink('ccl-x', { notes: 'test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- deleteCaseCodalLink ----

  describe('deleteCaseCodalLink', () => {
    it('should delete a link', async () => {
      (prisma.caseCodalLink.count as jest.Mock).mockResolvedValue(1);
      (prisma.caseCodalLink.delete as jest.Mock).mockResolvedValue({ id: 'ccl-1' });

      await expect(service.deleteCaseCodalLink('ccl-1')).resolves.not.toThrow();
    });

    it('should throw NotFoundException for missing link', async () => {
      (prisma.caseCodalLink.count as jest.Mock).mockResolvedValue(0);

      await expect(service.deleteCaseCodalLink('ccl-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ---- listCaseCodalLinks ----

  describe('listCaseCodalLinks', () => {
    it('should return paginated links', async () => {
      const items = [{ id: 'ccl-1' }, { id: 'ccl-2' }];
      (prisma.caseCodalLink.findMany as jest.Mock).mockResolvedValue(items);

      const result = await service.listCaseCodalLinks({});
      expect(result.items).toHaveLength(2);
      expect(result.meta.hasNext).toBe(false);
    });

    it('should filter by linkType', async () => {
      (prisma.caseCodalLink.findMany as jest.Mock).mockResolvedValue([]);

      await service.listCaseCodalLinks({ linkType: 'interprets' });
      expect(prisma.caseCodalLink.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ linkType: 'interprets' }),
        }),
      );
    });
  });

  // ---- Unresolved Citations ----

  describe('listUnresolvedCitations', () => {
    it('should return citations with null toDocumentId', async () => {
      (prisma.citation.findMany as jest.Mock).mockResolvedValue([]);

      await service.listUnresolvedCitations({});
      expect(prisma.citation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ toDocumentId: null }),
        }),
      );
    });
  });

  // ---- resolveCitation ----

  describe('resolveCitation', () => {
    it('should manually resolve a citation', async () => {
      (prisma.citation.findUnique as jest.Mock).mockResolvedValue({
        id: 'cit-1',
        toDocumentId: null,
      });
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue({ id: 'doc-2' });
      (prisma.citation.update as jest.Mock).mockResolvedValue({
        id: 'cit-1',
        toDocumentId: 'doc-2',
        resolverMethod: 'manual',
      });

      const result = await service.resolveCitation('cit-1', 'doc-2');
      expect(result.toDocumentId).toBe('doc-2');
      expect(result.resolverMethod).toBe('manual');
    });

    it('should throw NotFoundException for missing citation', async () => {
      (prisma.citation.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.resolveCitation('cit-x', 'doc-2')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for missing target document', async () => {
      (prisma.citation.findUnique as jest.Mock).mockResolvedValue({ id: 'cit-1' });
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.resolveCitation('cit-1', 'doc-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ---- triggerCitationResolution ----

  describe('triggerCitationResolution', () => {
    it('should call RAG service and update resolved citations', async () => {
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        title: 'Case 1',
      });
      (prisma.citation.count as jest.Mock).mockResolvedValue(2);
      (prisma.citation.findMany as jest.Mock).mockResolvedValue([
        { id: 'cit-1', citationText: 'G.R. No. 111', normalizedCitation: 'G.R. No. 111' },
        { id: 'cit-2', citationText: 'RA 1234', normalizedCitation: 'RA 1234' },
      ]);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          document_id: 'doc-1',
          resolved_count: 1,
          results: [
            { citation_id: 'cit-1', to_document_id: 'doc-10', confidence: 0.9, resolver_method: 'exact', resolved: true },
            { citation_id: 'cit-2', to_document_id: null, confidence: 0.3, resolver_method: 'none', resolved: false },
          ],
        }),
      });

      (prisma.citation.update as jest.Mock).mockResolvedValue({});

      const result = await service.triggerCitationResolution('doc-1');
      expect(result.resolvedCount).toBe(1);
      expect(result.unresolvedCitationCount).toBe(2);
    });

    it('should throw NotFoundException for missing document', async () => {
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.triggerCitationResolution('doc-x')).rejects.toThrow(NotFoundException);
    });

    it('should handle no unresolved citations', async () => {
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue({ id: 'doc-1', title: 'Case' });
      (prisma.citation.count as jest.Mock).mockResolvedValue(0);
      (prisma.citation.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.triggerCitationResolution('doc-1');
      expect(result.status).toBe('no_unresolved');
    });
  });

  // ---- buildPrecedentTrail ----

  describe('buildPrecedentTrail', () => {
    it('should build trail from documentId', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue(mockNode);
      (prisma.citation.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.doctrineExtract.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.buildPrecedentTrail({ documentId: 'doc-1' });
      expect(result.anchorDocumentId).toBe('doc-1');
      expect(result.trail.length).toBeGreaterThanOrEqual(1);
    });

    it('should build trail from doctrineId', async () => {
      (prisma.doctrineExtract.findUnique as jest.Mock).mockResolvedValue({
        id: 'de-1',
        legalDocumentId: 'doc-1',
      });
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue(mockNode);
      (prisma.citation.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.doctrineExtract.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.buildPrecedentTrail({ doctrineId: 'de-1' });
      expect(result.anchorDocumentId).toBe('doc-1');
    });

    it('should build trail from doctrineText', async () => {
      (prisma.doctrineExtract.findMany as jest.Mock).mockResolvedValue([
        { id: 'de-1', legalDocumentId: 'doc-1', text: 'Last clear chance' },
      ]);
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue(mockNode);
      (prisma.citation.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.buildPrecedentTrail({ doctrineText: 'Last clear chance' });
      expect(result.anchorDocumentId).toBe('doc-1');
    });

    it('should throw BadRequestException when no params provided', async () => {
      await expect(service.buildPrecedentTrail({})).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when doctrine not found', async () => {
      (prisma.doctrineExtract.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.buildPrecedentTrail({ doctrineId: 'de-x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when no matching text', async () => {
      (prisma.doctrineExtract.findMany as jest.Mock).mockResolvedValue([]);

      await expect(
        service.buildPrecedentTrail({ doctrineText: 'nonexistent' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- suggestCaseCodalLinks ----

  describe('suggestCaseCodalLinks', () => {
    it('should call RAG service for suggestions', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.legalDocument.findUniqueOrThrow as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        title: 'Case',
        documentType: 'case',
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          document_id: 'doc-1',
          document_title: 'Case',
          suggestions: [
            {
              codal_document_id: 'doc-codal-1',
              codal_title: 'Civil Code Art. 1191',
              codal_citation: null,
              link_type: 'interprets',
              relevant_excerpt: 'Article 1191 on rescission...',
              confidence: 0.85,
              reasoning: 'Case discusses rescission',
            },
          ],
          model_name: 'qwen-72b',
          prompt_template_version: 'v1',
        }),
      });

      (prisma.modelRun.create as jest.Mock).mockResolvedValue({});

      const result = await service.suggestCaseCodalLinks('doc-1');
      expect(result.suggestions).toHaveLength(1);
    });

    it('should throw BadRequestException for non-case documents', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.legalDocument.findUniqueOrThrow as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        title: 'Statute',
        documentType: 'statute',
      });

      await expect(service.suggestCaseCodalLinks('doc-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for missing document', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(0);

      await expect(service.suggestCaseCodalLinks('doc-x')).rejects.toThrow(NotFoundException);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
