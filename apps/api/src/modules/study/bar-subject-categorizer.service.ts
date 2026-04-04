import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Rule-based bar subject categorization for legal documents.
 * Uses keyword matching against document titles, citation text,
 * and document type to assign bar subject tags.
 *
 * Per PRD: bar subjects are Civil, Commercial, Criminal, Labor,
 * Political, Public International, Remedial, Taxation, Legal/Judicial Ethics.
 */

interface CategorizationRule {
  barSubjectCode: string;
  /** Keywords to match in title (case-insensitive) */
  titleKeywords: string[];
  /** Citation patterns (e.g., specific law codes) */
  citationPatterns: string[];
  /** Specific court/agency associations */
  agencies: string[];
}

const CATEGORIZATION_RULES: CategorizationRule[] = [
  {
    barSubjectCode: 'civil_law',
    titleKeywords: [
      'civil code', 'obligations', 'contracts', 'property', 'succession',
      'family code', 'marriage', 'annulment', 'adoption', 'custody',
      'torts', 'damages', 'quasi-delict', 'mortgage', 'pledge', 'lease',
      'sale of property', 'easement', 'usufruct', 'donation', 'agency',
      'partnership', 'trust', 'guardianship', 'emancipation', 'paternity',
    ],
    citationPatterns: ['R.A. No. 386', 'R.A. No. 8533', 'R.A. No. 9048'],
    agencies: [],
  },
  {
    barSubjectCode: 'commercial_law',
    titleKeywords: [
      'corporation code', 'insurance code', 'negotiable instruments',
      'banking', 'securities', 'intellectual property', 'trademark',
      'copyright', 'patent', 'corporation', 'partnership', 'transportation',
      'maritime', 'admiralty', 'warehouse receipt', 'letter of credit',
      'chattel mortgage', 'bouncing check', 'anti-money laundering',
      'revised corporation code', 'financial rehabilitation',
    ],
    citationPatterns: ['R.A. No. 11232', 'B.P. Blg. 22', 'R.A. No. 8293'],
    agencies: ['SEC', 'BSP', 'IC'],
  },
  {
    barSubjectCode: 'criminal_law',
    titleKeywords: [
      'revised penal code', 'penal code', 'criminal', 'murder', 'homicide',
      'robbery', 'theft', 'rape', 'kidnapping', 'illegal detention',
      'dangerous drugs', 'anti-trafficking', 'cybercrime', 'graft',
      'corruption', 'anti-graft', 'plunder', 'malversation', 'estafa',
      'libel', 'arson', 'carnapping', 'illegal firearms',
      'comprehensive dangerous drugs', 'anti-terrorism',
    ],
    citationPatterns: ['Act No. 3815', 'R.A. No. 9165', 'R.A. No. 10591'],
    agencies: [],
  },
  {
    barSubjectCode: 'labor_law',
    titleKeywords: [
      'labor code', 'employment', 'illegal dismissal', 'constructive dismissal',
      'unfair labor practice', 'collective bargaining', 'strike', 'lockout',
      'minimum wage', 'overtime', 'holiday pay', 'separation pay',
      'backwages', 'reinstatement', 'labor relations', 'social security',
      'employees compensation', 'overseas filipino workers', 'OFW',
      'migrant workers', 'DOLE', 'NLRC',
    ],
    citationPatterns: ['P.D. No. 442', 'R.A. No. 8042'],
    agencies: ['DOLE', 'NLRC', 'SSS', 'GSIS', 'POEA'],
  },
  {
    barSubjectCode: 'political_law',
    titleKeywords: [
      'constitution', 'constitutional', 'bill of rights', 'suffrage',
      'election', 'local government', 'administrative law', 'public officer',
      'impeachment', 'judicial review', 'separation of powers',
      'executive order', 'presidential decree', 'legislative', 'law of public officers',
      'commission on elections', 'COMELEC', 'civil service',
      'ombudsman', 'sandiganbayan', 'national defense',
      'emergency powers', 'martial law', 'writ of habeas corpus',
      'writ of amparo', 'writ of habeas data', 'writ of kalikasan',
    ],
    citationPatterns: [],
    agencies: ['COMELEC', 'CSC', 'COA', 'Ombudsman'],
  },
  {
    barSubjectCode: 'public_international_law',
    titleKeywords: [
      'international law', 'treaty', 'convention', 'extradition',
      'diplomatic immunity', 'law of the sea', 'UNCLOS', 'international court',
      'international humanitarian', 'human rights', 'international criminal',
      'Vienna convention', 'Geneva convention', 'asylum',
      'state immunity', 'territorial dispute',
    ],
    citationPatterns: [],
    agencies: [],
  },
  {
    barSubjectCode: 'remedial_law',
    titleKeywords: [
      'rules of court', 'civil procedure', 'criminal procedure',
      'evidence', 'jurisdiction', 'venue', 'appeal', 'certiorari',
      'mandamus', 'prohibition', 'injunction', 'habeas corpus',
      'execution of judgment', 'provisional remedy', 'attachment',
      'garnishment', 'receivership', 'replevin', 'small claims',
      'rules on summary procedure', 'special proceedings',
      'alternative dispute resolution', 'mediation', 'arbitration',
    ],
    citationPatterns: ['A.M. No.'],
    agencies: [],
  },
  {
    barSubjectCode: 'taxation_law',
    titleKeywords: [
      'tax', 'taxation', 'national internal revenue', 'NIRC',
      'income tax', 'value added tax', 'VAT', 'estate tax',
      'donor\'s tax', 'excise tax', 'customs', 'tariff',
      'local government taxation', 'real property tax', 'BIR',
      'tax reform', 'TRAIN', 'tax amnesty', 'tax evasion',
      'tax avoidance', 'documentary stamp', 'percentage tax',
    ],
    citationPatterns: ['R.A. No. 8424', 'R.A. No. 10963'],
    agencies: ['BIR', 'BOC', 'CTA'],
  },
  {
    barSubjectCode: 'legal_ethics',
    titleKeywords: [
      'legal ethics', 'code of professional responsibility',
      'disbarment', 'suspension of attorney', 'malpractice',
      'attorney misconduct', 'judicial ethics', 'canon of judicial conduct',
      'notarial law', 'notary public', 'unauthorized practice of law',
      'attorney-client privilege', 'conflict of interest',
      'legal aid', 'IBP', 'lawyer\'s oath',
    ],
    citationPatterns: [],
    agencies: ['IBP'],
  },
];

interface CategorizationResult {
  documentId: string;
  barSubjectCodes: string[];
}

@Injectable()
export class BarSubjectCategorizerService {
  private readonly logger = new Logger(BarSubjectCategorizerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run batch categorization on documents that don't have bar subject tags yet.
   * Returns a summary of how many documents were tagged.
   */
  async categorizeBatch(batchSize: number = 500): Promise<{
    processed: number;
    tagged: number;
    skipped: number;
    tagCounts: Record<string, number>;
  }> {
    // Get bar subject tags from the database
    const barSubjectTags = await this.prisma.legalMetadataTag.findMany({
      where: { tagType: 'bar_subject' },
    });
    const tagMap = new Map(barSubjectTags.map((t) => [t.code, t.id]));

    // Find published documents that have no bar subject tags yet
    const documents = await this.prisma.legalDocument.findMany({
      where: {
        status: 'published',
        isPublished: true,
        tagMaps: {
          none: {
            tag: { tagType: 'bar_subject' },
          },
        },
      },
      take: batchSize,
      select: {
        id: true,
        title: true,
        citationText: true,
        documentType: true,
        court: true,
        agency: true,
      },
    });

    if (documents.length === 0) {
      return { processed: 0, tagged: 0, skipped: 0, tagCounts: {} };
    }

    this.logger.log(`Processing ${documents.length} documents for bar subject categorization`);

    let tagged = 0;
    let skipped = 0;
    const tagCounts: Record<string, number> = {};

    for (const doc of documents) {
      const results = this.categorizeDocument(doc);
      if (results.length === 0) {
        skipped++;
        continue;
      }

      // Create tag mappings
      const tagMappings = results
        .map((code) => tagMap.get(code))
        .filter((tagId): tagId is string => tagId !== undefined)
        .map((tagId) => ({
          legalDocumentId: doc.id,
          tagId,
        }));

      if (tagMappings.length > 0) {
        await this.prisma.legalDocumentTagMap.createMany({
          data: tagMappings,
          skipDuplicates: true,
        });
        tagged++;

        for (const code of results) {
          tagCounts[code] = (tagCounts[code] ?? 0) + 1;
        }
      }
    }

    this.logger.log(
      `Categorization complete: ${documents.length} processed, ${tagged} tagged, ${skipped} skipped`,
    );

    return {
      processed: documents.length,
      tagged,
      skipped,
      tagCounts,
    };
  }

  /**
   * Categorize a single document using keyword rules.
   * Returns matching bar subject codes.
   */
  categorizeDocument(doc: {
    title: string;
    citationText: string | null;
    documentType: string;
    court: string | null;
    agency: string | null;
  }): string[] {
    const matched: string[] = [];
    const titleLower = doc.title.toLowerCase();
    const citationLower = (doc.citationText ?? '').toLowerCase();
    const agencyLower = (doc.agency ?? '').toLowerCase();

    for (const rule of CATEGORIZATION_RULES) {
      let score = 0;

      // Check title keywords
      for (const keyword of rule.titleKeywords) {
        if (titleLower.includes(keyword.toLowerCase())) {
          score += 2;
        }
      }

      // Check citation patterns
      for (const pattern of rule.citationPatterns) {
        if (citationLower.includes(pattern.toLowerCase())) {
          score += 3;
        }
      }

      // Check agency
      for (const agency of rule.agencies) {
        if (agencyLower.includes(agency.toLowerCase())) {
          score += 2;
        }
      }

      // Require at least a score of 2 to tag
      if (score >= 2) {
        matched.push(rule.barSubjectCode);
      }
    }

    return matched;
  }
}
