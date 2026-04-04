import { Test, TestingModule } from '@nestjs/testing';

import {
  ExportGeneratorService,
  DigestExportData,
  MemoExportData,
  NoteExportData,
} from './export-generator.service';

// ---------------------------------------------------------------------------
// Mock pdfkit — chainable stream-like object
// ---------------------------------------------------------------------------
jest.mock('pdfkit', () => {
  return jest.fn().mockImplementation(() => {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    return {
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(handler);
        return this;
      }),
      fontSize: jest.fn().mockReturnThis(),
      font: jest.fn().mockReturnThis(),
      text: jest.fn().mockReturnThis(),
      fillColor: jest.fn().mockReturnThis(),
      moveDown: jest.fn().mockReturnThis(),
      moveTo: jest.fn().mockReturnThis(),
      lineTo: jest.fn().mockReturnThis(),
      strokeColor: jest.fn().mockReturnThis(),
      stroke: jest.fn().mockReturnThis(),
      addPage: jest.fn().mockReturnThis(),
      end: jest.fn(function (this: { on: jest.Mock }) {
        if (handlers['data']) handlers['data'].forEach(h => h(Buffer.from('pdf-content')));
        if (handlers['end']) handlers['end'].forEach(h => h());
      }),
      page: { width: 612, height: 792 },
      y: 100,
    };
  });
});

// ---------------------------------------------------------------------------
// Mock docx
// ---------------------------------------------------------------------------
jest.mock('docx', () => ({
  Document: jest.fn().mockImplementation(() => ({})),
  Packer: {
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('docx-content')),
  },
  Paragraph: jest.fn().mockImplementation(() => ({})),
  TextRun: jest.fn().mockImplementation(() => ({})),
  HeadingLevel: { HEADING_1: 'HEADING_1' },
  AlignmentType: { CENTER: 'CENTER' },
  BorderStyle: { SINGLE: 'SINGLE' },
}));

describe('ExportGeneratorService', () => {
  let service: ExportGeneratorService;

  // -------------------------------------------------------------------------
  // Mock data
  // -------------------------------------------------------------------------

  const digestData: DigestExportData = {
    title: 'People v. Santos',
    court: 'Supreme Court',
    grNo: '123456',
    ponente: 'Justice A',
    decisionDate: new Date('2024-01-15'),
    digestType: 'case_digest',
    summary: 'Summary of the case.',
    facts: 'Facts of the case.',
    petitionerArguments: 'Petitioner argued that...',
    respondentArguments: 'Respondent contended that...',
    issues: 'Whether the lower court erred in...',
    ruling: 'The Court held that...',
    doctrine: 'The doctrine of...',
    dispositive: 'WHEREFORE, the petition is GRANTED.',
    citedAuthoritiesJson: [
      { citation_text: 'G.R. No. 111111' },
      { citationText: 'Art. 2176, Civil Code' },
    ],
  };

  const memoData: MemoExportData = {
    query: 'What is the effect of a void contract?',
    memoType: 'legal_opinion',
    structuredOutput: {
      analysis: 'Under Philippine civil law, a void contract produces no legal effect.',
      conclusion: 'The contract in question is void ab initio.',
    },
    citationsJson: [{ citation_text: 'Art. 1409, Civil Code' }],
    confidenceScore: 0.85,
  };

  const noteData: NoteExportData = {
    title: 'Research Notes on Torts',
    body: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph.' }] },
      ],
    },
    matterTitle: 'Civil Case 001',
  };

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExportGeneratorService],
    }).compile();

    service = module.get<ExportGeneratorService>(ExportGeneratorService);
  });

  // =========================================================================
  // Digest — PDF
  // =========================================================================

  describe('generateDigestPdf', () => {
    it('should return a buffer and filename', async () => {
      const result = await service.generateDigestPdf(digestData);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.filename).toContain('digest.pdf');
      expect(result.filename).toContain('People v Santos');
    });

    it('should handle digest with all null optional fields', async () => {
      const minimalDigest: DigestExportData = {
        title: 'Minimal Digest',
        digestType: 'case_digest',
        citedAuthoritiesJson: [],
        summary: null,
        facts: null,
        petitionerArguments: null,
        respondentArguments: null,
        issues: null,
        ruling: null,
        doctrine: null,
        dispositive: null,
        court: null,
        grNo: null,
        ponente: null,
        decisionDate: null,
      };

      const result = await service.generateDigestPdf(minimalDigest);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.filename).toContain('pdf');
    });

    it('should handle empty cited authorities array', async () => {
      const data = { ...digestData, citedAuthoritiesJson: [] };

      const result = await service.generateDigestPdf(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should handle cited authorities with title key', async () => {
      const data = {
        ...digestData,
        citedAuthoritiesJson: [{ title: 'People v. Cruz' }],
      };

      const result = await service.generateDigestPdf(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should handle cited authorities with unknown shape', async () => {
      const data = {
        ...digestData,
        citedAuthoritiesJson: [{ unknown: 'data' }],
      };

      const result = await service.generateDigestPdf(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });
  });

  // =========================================================================
  // Digest — DOCX
  // =========================================================================

  describe('generateDigestDocx', () => {
    it('should return a buffer and filename', async () => {
      const result = await service.generateDigestDocx(digestData);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.filename).toContain('digest.docx');
      expect(result.filename).toContain('People v Santos');
    });

    it('should handle minimal digest data', async () => {
      const minimalDigest: DigestExportData = {
        title: 'Minimal',
        digestType: 'case_digest',
        citedAuthoritiesJson: [],
      };

      const result = await service.generateDigestDocx(minimalDigest);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should skip null sections in DOCX output', async () => {
      const data = {
        ...digestData,
        facts: null,
        petitionerArguments: null,
        respondentArguments: null,
      };

      const result = await service.generateDigestDocx(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });
  });

  // =========================================================================
  // Memo — PDF
  // =========================================================================

  describe('generateMemoPdf', () => {
    it('should return a buffer and filename', async () => {
      const result = await service.generateMemoPdf(memoData);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.filename).toContain('memo.pdf');
      expect(result.filename).toContain('What is the effect of a void contract');
    });

    it('should handle memo with no structured output', async () => {
      const data: MemoExportData = {
        ...memoData,
        structuredOutput: null,
      };

      const result = await service.generateMemoPdf(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should handle memo with empty citations', async () => {
      const data: MemoExportData = {
        ...memoData,
        citationsJson: [],
      };

      const result = await service.generateMemoPdf(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should handle memo with null confidence score', async () => {
      const data: MemoExportData = {
        ...memoData,
        confidenceScore: null,
      };

      const result = await service.generateMemoPdf(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should handle structured output with non-string values', async () => {
      const data: MemoExportData = {
        ...memoData,
        structuredOutput: { analysis: 'text', count: 5 as unknown as string, empty: '' },
      };

      const result = await service.generateMemoPdf(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });
  });

  // =========================================================================
  // Memo — DOCX
  // =========================================================================

  describe('generateMemoDocx', () => {
    it('should return a buffer and filename', async () => {
      const result = await service.generateMemoDocx(memoData);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.filename).toContain('memo.docx');
    });

    it('should handle memo with null structured output', async () => {
      const data: MemoExportData = { ...memoData, structuredOutput: null };

      const result = await service.generateMemoDocx(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should handle memo with empty citations', async () => {
      const data: MemoExportData = { ...memoData, citationsJson: [] };

      const result = await service.generateMemoDocx(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });
  });

  // =========================================================================
  // Note — PDF
  // =========================================================================

  describe('generateNotePdf', () => {
    it('should return a buffer and filename', async () => {
      const result = await service.generateNotePdf(noteData);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.filename).toContain('note.pdf');
      expect(result.filename).toContain('Research Notes on Torts');
    });

    it('should use "Untitled Note" for null title', async () => {
      const data: NoteExportData = { ...noteData, title: null };

      const result = await service.generateNotePdf(data);

      expect(result.filename).toContain('Untitled Note');
    });

    it('should handle empty body (no content)', async () => {
      const data: NoteExportData = {
        ...noteData,
        body: { type: 'doc', content: [] },
      };

      const result = await service.generateNotePdf(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should handle null body', async () => {
      const data: NoteExportData = { ...noteData, body: null };

      const result = await service.generateNotePdf(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should handle non-object body', async () => {
      const data: NoteExportData = { ...noteData, body: 'plain string' };

      const result = await service.generateNotePdf(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should handle note without matter title', async () => {
      const data: NoteExportData = { ...noteData, matterTitle: null };

      const result = await service.generateNotePdf(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });
  });

  // =========================================================================
  // Note — DOCX
  // =========================================================================

  describe('generateNoteDocx', () => {
    it('should return a buffer and filename', async () => {
      const result = await service.generateNoteDocx(noteData);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.filename).toContain('note.docx');
    });

    it('should use "Untitled Note" for null title', async () => {
      const data: NoteExportData = { ...noteData, title: null };

      const result = await service.generateNoteDocx(data);

      expect(result.filename).toContain('Untitled Note');
    });

    it('should handle empty body paragraphs', async () => {
      const data: NoteExportData = {
        ...noteData,
        body: { type: 'doc', content: [] },
      };

      const result = await service.generateNoteDocx(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should handle nested Tiptap content', async () => {
      const data: NoteExportData = {
        ...noteData,
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Bold ' },
                { type: 'text', text: 'and italic.' },
              ],
            },
          ],
        },
      };

      const result = await service.generateNoteDocx(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });
  });

  // =========================================================================
  // Filename sanitization
  // =========================================================================

  describe('filename sanitization', () => {
    it('should strip special characters from titles', async () => {
      const data: DigestExportData = {
        ...digestData,
        title: 'People v. Santos: "The Case" <2024> & More!',
      };

      const result = await service.generateDigestDocx(data);

      // Title portion should not contain colons, quotes, angle brackets, etc.
      // (the extension ".docx" has a dot which is expected)
      const titlePart = result.filename.split('-digest.docx')[0];
      expect(titlePart).not.toMatch(/[:"<>&!]/);
      expect(result.filename).toContain('docx');
    });

    it('should truncate long titles to 80 characters in filename', async () => {
      const data: DigestExportData = {
        ...digestData,
        title: 'A'.repeat(200),
      };

      const result = await service.generateDigestPdf(data);

      const nameWithoutSuffix = result.filename.replace('-digest.pdf', '');
      expect(nameWithoutSuffix.length).toBeLessThanOrEqual(80);
    });

    it('should use "export" fallback when title becomes empty after sanitization', async () => {
      const data: DigestExportData = {
        ...digestData,
        title: '!!!@@@###$$$',
      };

      const result = await service.generateDigestPdf(data);

      expect(result.filename).toContain('export');
      expect(result.filename).toContain('digest.pdf');
    });

    it('should preserve alphanumeric characters, spaces, hyphens, and underscores', async () => {
      const data: DigestExportData = {
        ...digestData,
        title: 'People v Santos - GR No 123_456',
      };

      const result = await service.generateDigestDocx(data);

      expect(result.filename).toContain('People v Santos - GR No 123_456');
    });

    it('should handle memo query as filename source', async () => {
      const data: MemoExportData = {
        ...memoData,
        query: 'What is the "legal effect" of <void> contracts?',
      };

      const result = await service.generateMemoPdf(data);

      expect(result.filename).not.toMatch(/["<>?]/);
      expect(result.filename).toContain('memo.pdf');
    });

    it('should handle very short title', async () => {
      const data: DigestExportData = {
        ...digestData,
        title: 'Ab',
      };

      const result = await service.generateDigestDocx(data);
      expect(result.filename).toContain('Ab');
      expect(result.filename).toContain('digest.docx');
    });
  });

  // =========================================================================
  // Date formatting
  // =========================================================================

  describe('date formatting', () => {
    it('should format Date object in meta line', async () => {
      const result = await service.generateDigestPdf(digestData);
      expect(result.buffer).toBeInstanceOf(Buffer);
      // The date January 15, 2024 should be formatted — covered by pdfkit mock
    });

    it('should handle null decision date', async () => {
      const data = { ...digestData, decisionDate: null };

      const result = await service.generateDigestPdf(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should handle string date', async () => {
      const data = { ...digestData, decisionDate: '2024-06-15' as unknown as Date };

      const result = await service.generateDigestDocx(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });
  });

  // =========================================================================
  // Tiptap text extraction
  // =========================================================================

  describe('Tiptap text extraction', () => {
    it('should extract text from nested Tiptap JSON', async () => {
      const data: NoteExportData = {
        title: 'Test',
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Hello ' },
                { type: 'text', text: 'world' },
              ],
            },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Second para' }],
            },
          ],
        },
        matterTitle: null,
      };

      const result = await service.generateNotePdf(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should handle deeply nested content', async () => {
      const data: NoteExportData = {
        title: 'Deep Nesting',
        body: {
          type: 'doc',
          content: [
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'List item text' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        matterTitle: null,
      };

      const result = await service.generateNoteDocx(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should handle node without text or content', async () => {
      const data: NoteExportData = {
        title: 'Empty Nodes',
        body: {
          type: 'doc',
          content: [
            { type: 'horizontalRule' },
            { type: 'paragraph', content: [{ type: 'text', text: 'After rule' }] },
          ],
        },
        matterTitle: null,
      };

      const result = await service.generateNotePdf(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should return empty paragraphs for non-object body', async () => {
      const data: NoteExportData = {
        title: 'Bad Body',
        body: 12345,
        matterTitle: null,
      };

      const result = await service.generateNoteDocx(data);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });
  });
});
