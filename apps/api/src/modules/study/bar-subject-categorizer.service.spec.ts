import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { BarSubjectCategorizerService } from './bar-subject-categorizer.service';

describe('BarSubjectCategorizerService', () => {
  let service: BarSubjectCategorizerService;
  let prisma: jest.Mocked<PrismaService>;

  const mockTags = [
    { id: 'tag-civil', code: 'civil_law', name: 'Civil Law', tagType: 'bar_subject' },
    { id: 'tag-criminal', code: 'criminal_law', name: 'Criminal Law', tagType: 'bar_subject' },
    { id: 'tag-commercial', code: 'commercial_law', name: 'Commercial Law', tagType: 'bar_subject' },
    { id: 'tag-labor', code: 'labor_law', name: 'Labor Law', tagType: 'bar_subject' },
    { id: 'tag-political', code: 'political_law', name: 'Political Law', tagType: 'bar_subject' },
    { id: 'tag-pil', code: 'public_international_law', name: 'Public International Law', tagType: 'bar_subject' },
    { id: 'tag-remedial', code: 'remedial_law', name: 'Remedial Law', tagType: 'bar_subject' },
    { id: 'tag-tax', code: 'taxation_law', name: 'Taxation Law', tagType: 'bar_subject' },
    { id: 'tag-ethics', code: 'legal_ethics', name: 'Legal Ethics', tagType: 'bar_subject' },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BarSubjectCategorizerService,
        {
          provide: PrismaService,
          useValue: {
            legalMetadataTag: {
              findMany: jest.fn(),
            },
            legalDocument: {
              findMany: jest.fn(),
            },
            legalDocumentTagMap: {
              createMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<BarSubjectCategorizerService>(BarSubjectCategorizerService);
    prisma = module.get(PrismaService);
  });

  describe('categorizeDocument', () => {
    it('should categorize civil law case by title keywords', () => {
      const result = service.categorizeDocument({
        title: 'Obligations and Contracts — Rescission under the Civil Code',
        citationText: null,
        documentType: 'case',
        court: 'Supreme Court',
        agency: null,
      });

      expect(result).toContain('civil_law');
    });

    it('should categorize criminal law case by title keywords', () => {
      const result = service.categorizeDocument({
        title: 'People of the Philippines v. Juan Dela Cruz — Murder with Treachery',
        citationText: null,
        documentType: 'case',
        court: 'Supreme Court',
        agency: null,
      });

      expect(result).toContain('criminal_law');
    });

    it('should categorize labor law case by title keywords', () => {
      const result = service.categorizeDocument({
        title: 'Illegal Dismissal — Constructive Dismissal and Reinstatement',
        citationText: null,
        documentType: 'case',
        court: 'Supreme Court',
        agency: null,
      });

      expect(result).toContain('labor_law');
    });

    it('should categorize by citation pattern (Revised Penal Code)', () => {
      const result = service.categorizeDocument({
        title: 'Generic Case Title',
        citationText: 'Act No. 3815',
        documentType: 'statute',
        court: null,
        agency: null,
      });

      expect(result).toContain('criminal_law');
    });

    it('should categorize by citation pattern (Corporation Code)', () => {
      const result = service.categorizeDocument({
        title: 'Business Organization Registration',
        citationText: 'R.A. No. 11232',
        documentType: 'statute',
        court: null,
        agency: null,
      });

      expect(result).toContain('commercial_law');
    });

    it('should categorize by agency (DOLE → labor law)', () => {
      const result = service.categorizeDocument({
        title: 'Department Order',
        citationText: null,
        documentType: 'issuance',
        court: null,
        agency: 'DOLE',
      });

      expect(result).toContain('labor_law');
    });

    it('should categorize by agency (SEC → commercial law)', () => {
      const result = service.categorizeDocument({
        title: 'Advisory Memorandum',
        citationText: null,
        documentType: 'issuance',
        court: null,
        agency: 'SEC',
      });

      expect(result).toContain('commercial_law');
    });

    it('should categorize by agency (BIR → taxation law)', () => {
      const result = service.categorizeDocument({
        title: 'Revenue Regulation',
        citationText: null,
        documentType: 'issuance',
        court: null,
        agency: 'BIR',
      });

      expect(result).toContain('taxation_law');
    });

    it('should categorize political law by constitution keywords', () => {
      const result = service.categorizeDocument({
        title: 'Constitutional Right to Due Process — Bill of Rights',
        citationText: null,
        documentType: 'case',
        court: 'Supreme Court',
        agency: null,
      });

      expect(result).toContain('political_law');
    });

    it('should categorize public international law by treaty keywords', () => {
      const result = service.categorizeDocument({
        title: 'UNCLOS — Law of the Sea and Territorial Dispute',
        citationText: null,
        documentType: 'case',
        court: null,
        agency: null,
      });

      expect(result).toContain('public_international_law');
    });

    it('should categorize remedial law by procedural keywords', () => {
      const result = service.categorizeDocument({
        title: 'Rules of Court — Civil Procedure and Appeal',
        citationText: null,
        documentType: 'rule',
        court: null,
        agency: null,
      });

      expect(result).toContain('remedial_law');
    });

    it('should categorize taxation law by tax keywords', () => {
      const result = service.categorizeDocument({
        title: 'Income Tax Assessment and VAT Deductions',
        citationText: null,
        documentType: 'case',
        court: 'CTA',
        agency: null,
      });

      expect(result).toContain('taxation_law');
    });

    it('should categorize legal ethics by disbarment keywords', () => {
      const result = service.categorizeDocument({
        title: 'Disbarment Proceedings — Code of Professional Responsibility',
        citationText: null,
        documentType: 'case',
        court: 'Supreme Court',
        agency: null,
      });

      expect(result).toContain('legal_ethics');
    });

    it('should return multiple categories for cross-cutting documents', () => {
      const result = service.categorizeDocument({
        title: 'Labor Code and Civil Procedure — Illegal Dismissal Appeal',
        citationText: null,
        documentType: 'case',
        court: null,
        agency: null,
      });

      // Should match both labor and remedial
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty array for unclassifiable documents', () => {
      const result = service.categorizeDocument({
        title: 'Minutes of the Regular Meeting',
        citationText: null,
        documentType: 'memorandum',
        court: null,
        agency: null,
      });

      expect(result).toEqual([]);
    });

    it('should be case-insensitive for title matching', () => {
      const result = service.categorizeDocument({
        title: 'REVISED PENAL CODE — MURDER',
        citationText: null,
        documentType: 'case',
        court: null,
        agency: null,
      });

      expect(result).toContain('criminal_law');
    });

    it('should handle null citation text gracefully', () => {
      const result = service.categorizeDocument({
        title: 'Torts and Damages',
        citationText: null,
        documentType: 'case',
        court: null,
        agency: null,
      });

      expect(result).toContain('civil_law');
    });

    it('should handle null agency gracefully', () => {
      const result = service.categorizeDocument({
        title: 'Tax Reform for Acceleration and Inclusion (TRAIN)',
        citationText: null,
        documentType: 'statute',
        court: null,
        agency: null,
      });

      expect(result).toContain('taxation_law');
    });
  });

  describe('categorizeBatch', () => {
    it('should return zero counts when no untagged documents exist', async () => {
      (prisma.legalMetadataTag.findMany as jest.Mock).mockResolvedValueOnce(mockTags);
      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.categorizeBatch();

      expect(result).toEqual({ processed: 0, tagged: 0, skipped: 0, tagCounts: {} });
    });

    it('should tag documents and return summary', async () => {
      (prisma.legalMetadataTag.findMany as jest.Mock).mockResolvedValueOnce(mockTags);
      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: 'doc-1',
          title: 'Illegal Dismissal Case',
          citationText: null,
          documentType: 'case',
          court: 'Supreme Court',
          agency: null,
        },
        {
          id: 'doc-2',
          title: 'Income Tax Assessment',
          citationText: null,
          documentType: 'case',
          court: 'CTA',
          agency: null,
        },
      ]);
      (prisma.legalDocumentTagMap.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await service.categorizeBatch(100);

      expect(result.processed).toBe(2);
      expect(result.tagged).toBe(2);
      expect(result.skipped).toBe(0);
      expect(prisma.legalDocumentTagMap.createMany).toHaveBeenCalledTimes(2);
    });

    it('should skip documents that match no rules', async () => {
      (prisma.legalMetadataTag.findMany as jest.Mock).mockResolvedValueOnce(mockTags);
      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: 'doc-3',
          title: 'Random Document',
          citationText: null,
          documentType: 'memorandum',
          court: null,
          agency: null,
        },
      ]);

      const result = await service.categorizeBatch(100);

      expect(result.processed).toBe(1);
      expect(result.tagged).toBe(0);
      expect(result.skipped).toBe(1);
      expect(prisma.legalDocumentTagMap.createMany).not.toHaveBeenCalled();
    });

    it('should use default batch size of 500', async () => {
      (prisma.legalMetadataTag.findMany as jest.Mock).mockResolvedValueOnce(mockTags);
      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValueOnce([]);

      await service.categorizeBatch();

      expect(prisma.legalDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 500 }),
      );
    });

    it('should skip tag creation when tag codes do not map to DB tags', async () => {
      // Return empty tag list so no codes map
      (prisma.legalMetadataTag.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: 'doc-4',
          title: 'Murder Case — Revised Penal Code',
          citationText: null,
          documentType: 'case',
          court: null,
          agency: null,
        },
      ]);

      const result = await service.categorizeBatch(100);

      // Document matches criminal_law rule but tag doesn't exist in DB
      expect(result.processed).toBe(1);
      expect(prisma.legalDocumentTagMap.createMany).not.toHaveBeenCalled();
    });

    it('should track tag counts per subject', async () => {
      (prisma.legalMetadataTag.findMany as jest.Mock).mockResolvedValueOnce(mockTags);
      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: 'doc-5',
          title: 'Civil Code Obligations',
          citationText: null,
          documentType: 'case',
          court: null,
          agency: null,
        },
        {
          id: 'doc-6',
          title: 'Contracts and Property',
          citationText: null,
          documentType: 'case',
          court: null,
          agency: null,
        },
      ]);
      (prisma.legalDocumentTagMap.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await service.categorizeBatch(100);

      expect(result.tagCounts['civil_law']).toBeGreaterThanOrEqual(2);
    });
  });
});
