import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { AudioRenditionService } from './audio-rendition.service';
import { AudioStorageService } from './audio-storage.service';
import { audioJobId } from './audio.types';
import type { TtsClient } from './tts.client';
import { sanitizeRulingText } from './sanitize-ruling.util';

interface PrismaMock {
  digest: { findUnique: jest.Mock };
  barExamAnswer: { findUnique: jest.Mock };
  legalDocument: { findUnique: jest.Mock };
  legalDocumentSection: { findMany: jest.Mock };
  audioRendition: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    upsert: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
  };
}

/** `env` overrides config lookups; empty (the default) means every key falls
 *  back to its production default, i.e. Polly/Matthew. */
function build(env: Record<string, string> = {}) {
  const prisma: PrismaMock = {
    digest: { findUnique: jest.fn() },
    barExamAnswer: { findUnique: jest.fn() },
    legalDocument: { findUnique: jest.fn() },
    legalDocumentSection: { findMany: jest.fn() },
    audioRendition: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
  const tts = { synthesize: jest.fn() };
  const s3 = { upload: jest.fn(), getSignedUrl: jest.fn() };
  const queue = { add: jest.fn() };
  const config: ConfigService = {
    get: (key: string, def?: string): string | undefined => env[key] ?? def,
  } as unknown as ConfigService;

  const service = new AudioRenditionService(
    prisma as unknown as PrismaService,
    tts as unknown as TtsClient,
    s3 as unknown as AudioStorageService,
    config,
    queue as unknown as Queue,
  );
  return { service, prisma, tts, s3, queue };
}

const DIGEST_ROW = {
  title: 'People v. Dela Cruz',
  facts: 'The accused was charged.',
  issues: 'Whether guilt was proven.',
  ruling: 'The Court affirmed.',
  doctrine: 'Proof beyond reasonable doubt.',
  dispositive: 'WHEREFORE, the appeal is denied.',
  visibility: 'public_editorial',
};

// Word marks (last word `time` is the duration estimate), a sentence mark, plus
// ssml-type `<mark>` marks (seg-id → time) that drive the read-along manifest.
const MARKS = Buffer.from(
  [
    '{"time":0,"type":"ssml","value":"seg-0"}',
    '{"time":120,"type":"word","value":"People"}',
    '{"time":1500,"type":"ssml","value":"seg-2"}',
    '{"time":4200,"type":"word","value":"denied"}',
    '{"time":4300,"type":"sentence","value":"."}',
  ].join('\n'),
);

describe('AudioRenditionService', () => {
  it('defaults the voice to the configured Matthew', () => {
    const { service } = build();
    expect(service.voiceId).toBe('Matthew');
  });

  describe('generate — happy path (digest)', () => {
    it('synthesizes, uploads mp3 + marks, and persists a ready rendition', async () => {
      const { service, prisma, tts, s3 } = build();
      prisma.digest.findUnique.mockResolvedValue(DIGEST_ROW);
      prisma.audioRendition.findFirst.mockResolvedValue(null);
      tts.synthesize.mockResolvedValue({
        audio: Buffer.from('MP3BYTES'),
        marks: MARKS,
      });
      prisma.audioRendition.upsert.mockImplementation(
        (args: { create: Record<string, unknown> }) => ({
          id: 'rend-1',
          ...args.create,
        }),
      );

      const result = await service.generate({
        contentType: 'digest',
        contentId: 'digest-1',
        language: 'en',
      });

      expect(tts.synthesize).toHaveBeenCalledTimes(1);
      // The call site is provider-agnostic: BOTH projections are passed, and
      // each backend consumes the one it understands.
      const input = tts.synthesize.mock.calls[0]?.[0] as {
        ssml: string;
        segments: Array<{ id: string; text: string; leadSilenceMs: number }>;
      };
      expect(input.ssml.startsWith('<speak>')).toBe(true);
      expect(input.ssml).toContain('versus');
      // Segment ids must line up with the SSML marks the same document emits.
      expect(input.segments.length).toBeGreaterThan(0);
      expect(input.segments[0]?.id).toBe('seg-0');
      expect(input.segments.every((s) => typeof s.leadSilenceMs === 'number')).toBe(
        true,
      );

      expect(s3.upload).toHaveBeenCalledTimes(3);
      const keys = s3.upload.mock.calls.map((c) => c[0] as string);
      expect(keys).toContain('audio/digest/digest-1/Matthew-en.mp3');
      expect(keys).toContain('audio/digest/digest-1/Matthew-en.marks.json');
      expect(keys).toContain('audio/digest/digest-1/Matthew-en.readalong.json');

      const upsertArg = prisma.audioRendition.upsert.mock.calls[0]?.[0] as {
        create: Record<string, unknown>;
      };
      expect(upsertArg.create).toMatchObject({
        contentType: 'digest',
        contentId: 'digest-1',
        language: 'en',
        voiceId: 'Matthew',
        engine: 'neural',
        status: 'ready',
        durationMs: 4200,
        visibility: 'public_editorial',
        readalongObjectKey: 'audio/digest/digest-1/Matthew-en.readalong.json',
      });
      expect(upsertArg.create['charCount']).toBeGreaterThan(0);
      expect(typeof upsertArg.create['contentHash']).toBe('string');
      expect(result.id).toBe('rend-1');
    });

    it('uploads a readalong.json joining ssml marks onto the manifest', async () => {
      const { service, prisma, tts, s3 } = build();
      prisma.digest.findUnique.mockResolvedValue(DIGEST_ROW);
      prisma.audioRendition.findFirst.mockResolvedValue(null);
      tts.synthesize.mockResolvedValue({
        audio: Buffer.from('MP3BYTES'),
        marks: MARKS,
      });
      prisma.audioRendition.upsert.mockResolvedValue({ id: 'rend-1' });

      await service.generate({
        contentType: 'digest',
        contentId: 'digest-1',
        language: 'en',
      });

      const call = s3.upload.mock.calls.find((c) =>
        (c[0] as string).endsWith('.readalong.json'),
      );
      expect(call).toBeDefined();
      const manifest = JSON.parse((call?.[1] as Buffer).toString('utf-8')) as {
        version: number;
        voiceId: string;
        durationMs: number | null;
        segments: Array<{
          id: string;
          kind: string;
          sectionKey: string;
          text: string;
          timeMs: number;
        }>;
      };

      expect(manifest.version).toBe(2); // READALONG_SCHEMA_VERSION
      expect(manifest.voiceId).toBe('Matthew');
      expect(manifest.durationMs).toBe(4200);
      // First segment is the title at t=0, with its ORIGINAL text.
      expect(manifest.segments[0]).toEqual({
        id: 'seg-0',
        kind: 'title',
        sectionKey: 'title',
        text: 'People v. Dela Cruz',
        timeMs: 0,
      });
      // seg-2 got its time from the matching ssml mark; segments are time-ordered.
      // Sections narrate in page display order: Doctrine is first, so seg-2 is
      // the first Doctrine sentence.
      const seg2 = manifest.segments.find((s) => s.id === 'seg-2');
      expect(seg2?.timeMs).toBe(1500);
      expect(seg2?.kind).toBe('sentence');
      expect(seg2?.sectionKey).toBe('doctrine');
      const times = manifest.segments.map((s) => s.timeMs);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });

    it('folds READALONG_SCHEMA_VERSION into the content hash', async () => {
      const { service, prisma, tts, s3 } = build();
      prisma.digest.findUnique.mockResolvedValue(DIGEST_ROW);
      prisma.audioRendition.findFirst.mockResolvedValue(null);
      tts.synthesize.mockResolvedValue({
        audio: Buffer.from('MP3BYTES'),
        marks: MARKS,
      });
      prisma.audioRendition.upsert.mockImplementation(
        (args: { create: Record<string, unknown> }) => ({
          id: 'rend-1',
          ...args.create,
        }),
      );

      await service.generate({
        contentType: 'digest',
        contentId: 'digest-1',
        language: 'en',
      });

      const create = prisma.audioRendition.upsert.mock.calls[0]?.[0]
        .create as Record<string, unknown>;
      // Hash of the VERSIONED input (`${version}\n${normalizedText}`), not the
      // bare normalizedText — so a version bump invalidates legacy rows.
      const { toSsmlDocument } = await import('./legal-ssml.util');
      const { audioContentHashInput } = await import('./audio.types');
      const crypto = await import('crypto');
      // Section order + ruling sanitization must mirror resolveText exactly so
      // the reconstructed normalizedText (and thus the hash) matches.
      const { normalizedText } = toSsmlDocument({
        title: DIGEST_ROW.title,
        sections: [
          { key: 'doctrine', heading: 'Doctrine', body: DIGEST_ROW.doctrine },
          { key: 'facts', heading: 'Facts', body: DIGEST_ROW.facts },
          { key: 'issues', heading: 'Issues', body: DIGEST_ROW.issues },
          {
            key: 'ruling',
            heading: 'Ruling',
            body: sanitizeRulingText(DIGEST_ROW.ruling),
          },
          {
            key: 'dispositive',
            heading: 'Dispositive Portion',
            body: DIGEST_ROW.dispositive,
          },
        ],
      });
      const expected = crypto
        .createHash('sha256')
        .update(audioContentHashInput(normalizedText))
        .digest('hex');
      const bare = crypto
        .createHash('sha256')
        .update(normalizedText)
        .digest('hex');
      expect(create['contentHash']).toBe(expected);
      expect(create['contentHash']).not.toBe(bare);
    });
  });

  describe('generate — content-hash short-circuit', () => {
    it('returns the existing ready rendition without calling Polly or S3', async () => {
      const { service, prisma, tts, s3 } = build();
      prisma.digest.findUnique.mockResolvedValue(DIGEST_ROW);
      prisma.audioRendition.findFirst.mockResolvedValue({
        id: 'cached-1',
        status: 'ready',
      });

      const result = await service.generate({
        contentType: 'digest',
        contentId: 'digest-1',
        language: 'en',
      });

      expect(result.id).toBe('cached-1');
      expect(tts.synthesize).not.toHaveBeenCalled();
      expect(s3.upload).not.toHaveBeenCalled();
      expect(prisma.audioRendition.upsert).not.toHaveBeenCalled();
    });

    it('bypasses the short-circuit when force is set', async () => {
      const { service, prisma, tts, s3 } = build();
      prisma.digest.findUnique.mockResolvedValue(DIGEST_ROW);
      prisma.audioRendition.findFirst.mockResolvedValue({
        id: 'cached-1',
        status: 'ready',
      });
      tts.synthesize.mockResolvedValue({ audio: Buffer.from('x'), marks: MARKS });
      prisma.audioRendition.upsert.mockResolvedValue({ id: 'rend-2' });

      await service.generate({
        contentType: 'digest',
        contentId: 'digest-1',
        language: 'en',
        force: true,
      });

      expect(prisma.audioRendition.findFirst).not.toHaveBeenCalled();
      expect(tts.synthesize).toHaveBeenCalledTimes(1);
      expect(s3.upload).toHaveBeenCalledTimes(3);
    });
  });

  describe('resolveText', () => {
    it('throws NotFound when the digest is missing', async () => {
      const { service, prisma } = build();
      prisma.digest.findUnique.mockResolvedValue(null);
      await expect(service.resolveText('digest', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('reads bar exam answer text', async () => {
      const { service, prisma } = build();
      prisma.barExamAnswer.findUnique.mockResolvedValue({
        answerText: 'The answer.',
        visibility: 'public_editorial',
      });
      const resolved = await service.resolveText('bar_exam_answer', 'ans-1');
      expect(resolved.doc.sections[0]?.body).toBe('The answer.');
      expect(resolved.doc.title).toBeUndefined();
      expect(resolved.visibility).toBe('public_editorial');
    });
  });

  describe('buildReadModel — signed URL shape', () => {
    it('signs audio + marks URLs for a ready rendition', async () => {
      const { service, s3 } = build();
      s3.getSignedUrl.mockImplementation((key: string) =>
        Promise.resolve(`https://signed.example/${key}?sig=abc`),
      );

      const model = await service.buildReadModel({
        status: 'ready',
        audioObjectKey: 'audio/digest/d1/Matthew-en.mp3',
        marksObjectKey: 'audio/digest/d1/Matthew-en.marks.json',
        readalongObjectKey: 'audio/digest/d1/Matthew-en.readalong.json',
        durationMs: 4200,
        language: 'en',
        voiceId: 'Matthew',
      });

      expect(model.status).toBe('ready');
      expect(model.audioUrl).toMatch(/^https:\/\/signed\.example\/.*\.mp3\?sig=/);
      expect(model.marksUrl).toMatch(/\.marks\.json\?sig=/);
      expect(model.readalongUrl).toMatch(/\.readalong\.json\?sig=/);
      expect(model.durationMs).toBe(4200);
      expect(s3.getSignedUrl).toHaveBeenCalledWith(
        'audio/digest/d1/Matthew-en.mp3',
        300,
      );
    });

    it('returns a null readalongUrl when no manifest key is set (legacy row)', async () => {
      const { service, s3 } = build();
      s3.getSignedUrl.mockImplementation((key: string) =>
        Promise.resolve(`https://signed.example/${key}?sig=abc`),
      );
      const model = await service.buildReadModel({
        status: 'ready',
        audioObjectKey: 'audio/digest/d1/Matthew-en.mp3',
        marksObjectKey: 'audio/digest/d1/Matthew-en.marks.json',
        readalongObjectKey: null,
        durationMs: 4200,
        language: 'en',
        voiceId: 'Matthew',
      });
      expect(model.audioUrl).not.toBeNull();
      expect(model.readalongUrl).toBeNull();
    });

    it('returns null URLs for a non-ready rendition', async () => {
      const { service, s3 } = build();
      const model = await service.buildReadModel({
        status: 'pending',
        audioObjectKey: 'x.mp3',
        marksObjectKey: null,
        readalongObjectKey: null,
        durationMs: null,
        language: 'en',
        voiceId: 'Matthew',
      });
      expect(model.audioUrl).toBeNull();
      expect(model.marksUrl).toBeNull();
      expect(model.readalongUrl).toBeNull();
      expect(s3.getSignedUrl).not.toHaveBeenCalled();
    });
  });

  describe('requestGeneration', () => {
    it('enqueues with a deterministic jobId for normal requests', async () => {
      const { service, queue } = build();
      await service.requestGeneration('digest', 'd1', 'en', false);
      const opts = queue.add.mock.calls[0]?.[2] as { jobId?: string };
      expect(opts.jobId).toBe(audioJobId('digest', 'd1', 'en', 'Matthew'));
      // This assertion previously pinned the literal 'digest:d1:en:Matthew',
      // which BullMQ rejects — see audio-job-id.spec.ts, where the id is run
      // through the real validator instead of this mocked queue.
      expect(opts.jobId).not.toContain(':');
    });

    it('omits the jobId for forced regen so it always runs', async () => {
      const { service, queue } = build();
      await service.requestGeneration('digest', 'd1', 'en', true);
      const opts = queue.add.mock.calls[0]?.[2] as { jobId?: string };
      expect(opts.jobId).toBeUndefined();
    });
  });

  describe('isGenerationEnabled — tier gating', () => {
    function gate(env: Record<string, string>) {
      const prisma = {} as unknown as PrismaService;
      const config = {
        get: (key: string, fallback?: string) => env[key] ?? fallback,
      } as unknown as ConfigService;
      return new AudioRenditionService(
        prisma,
        { synthesize: jest.fn() } as unknown as TtsClient,
        {} as unknown as AudioStorageService,
        config,
        {} as unknown as Queue,
      );
    }

    const ON = { AUDIO_RECONCILER_ENABLED: 'true' };
    const ON_WITH_DECISIONS = { ...ON, AUDIO_RECONCILE_DECISIONS: 'true' };

    it('refuses everything while the reconciler flag is false', () => {
      const service = gate({});
      expect(service.isGenerationEnabled('digest')).toBe(false);
      expect(service.isGenerationEnabled('legal_document', 'codal')).toBe(false);
    });

    it('lets a codal through on AUDIO_RECONCILER_ENABLED alone', () => {
      const service = gate(ON);
      expect(service.isGenerationEnabled('legal_document', 'codal')).toBe(true);
      expect(service.isGenerationEnabled('legal_document', 'republic_act')).toBe(
        true,
      );
      expect(service.isGenerationEnabled('legal_document', 'rules_of_court')).toBe(
        true,
      );
    });

    it('holds a decision behind the second flag', () => {
      expect(gate(ON).isGenerationEnabled('legal_document', 'decision')).toBe(false);
      expect(
        gate(ON_WITH_DECISIONS).isGenerationEnabled('legal_document', 'decision'),
      ).toBe(true);
    });

    it('refuses out-of-scope document types even with both flags on', () => {
      const service = gate(ON_WITH_DECISIONS);
      expect(
        service.isGenerationEnabled('legal_document', 'bar_exam_questions'),
      ).toBe(false);
      expect(
        service.isGenerationEnabled('legal_document', 'administrative_matter'),
      ).toBe(false);
      expect(service.isGenerationEnabled('legal_document', undefined)).toBe(false);
    });
  });

  describe('resolveText — legal_document (codals and decisions)', () => {
    const PUBLISHED = { title: 'Tanada v. Angara', status: 'published' };

    it('resolves sections in ordering sequence', async () => {
      const { service, prisma } = build();
      prisma.legalDocument.findUnique.mockResolvedValue(PUBLISHED);
      prisma.legalDocumentSection.findMany.mockResolvedValue([
        { id: 's1', sectionLabel: 'Article I', sectionType: 'article', plainText: 'First body.' },
        { id: 's2', sectionLabel: 'Article II', sectionType: 'article', plainText: 'Second body.' },
      ]);

      const { doc } = await service.resolveText('legal_document', 'doc-1');

      expect(prisma.legalDocumentSection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { ordering: 'asc' } }),
      );
      expect(doc.sections.map((s) => s.key)).toEqual(['s1', 's2']);
      expect(doc.sections[0]?.heading).toBe('Article I');
      expect(doc.title).toBe('Tanada v. Angara');
    });

    it('resolves a many-section decision fully and falls back to sectionType', async () => {
      const { service, prisma } = build();
      prisma.legalDocument.findUnique.mockResolvedValue(PUBLISHED);
      prisma.legalDocumentSection.findMany.mockResolvedValue(
        Array.from({ length: 40 }, (_, i) => ({
          id: `s${i}`,
          sectionLabel: null,
          sectionType: 'body',
          plainText: `Paragraph ${i} of the decision.`,
        })),
      );

      const { doc } = await service.resolveText('legal_document', 'doc-2');

      expect(doc.sections).toHaveLength(40);
      expect(doc.sections[0]?.heading).toBe('body');
    });

    it('skips sections with blank or null plain text', async () => {
      const { service, prisma } = build();
      prisma.legalDocument.findUnique.mockResolvedValue(PUBLISHED);
      prisma.legalDocumentSection.findMany.mockResolvedValue([
        { id: 's1', sectionLabel: 'Kept', sectionType: 'article', plainText: 'Real body.' },
        { id: 's2', sectionLabel: 'Blank', sectionType: 'article', plainText: '   ' },
        { id: 's3', sectionLabel: 'Null', sectionType: 'article', plainText: null },
      ]);

      const { doc } = await service.resolveText('legal_document', 'doc-3');

      expect(doc.sections.map((s) => s.key)).toEqual(['s1']);
    });

    it('reports public_editorial visibility without reading a column', async () => {
      const { service, prisma } = build();
      prisma.legalDocument.findUnique.mockResolvedValue(PUBLISHED);
      prisma.legalDocumentSection.findMany.mockResolvedValue([
        { id: 's1', sectionLabel: 'A', sectionType: 'article', plainText: 'Body.' },
      ]);

      const { visibility } = await service.resolveText('legal_document', 'doc-5');

      // legal_documents has no visibility column; publication is `status`.
      expect(visibility).toBe('public_editorial');
      const select = prisma.legalDocument.findUnique.mock.calls[0]?.[0] as {
        select: Record<string, boolean>;
      };
      expect(select.select).not.toHaveProperty('visibility');
    });

    it('throws when the document is not published', async () => {
      const { service, prisma } = build();
      prisma.legalDocument.findUnique.mockResolvedValue({
        ...PUBLISHED,
        status: 'draft',
      });

      await expect(service.resolveText('legal_document', 'doc-4')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws when the document does not exist', async () => {
      const { service, prisma } = build();
      prisma.legalDocument.findUnique.mockResolvedValue(null);

      await expect(service.resolveText('legal_document', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getRendition — surviving a provider switch', () => {
    /**
     * In-memory stand-in for `audio_renditions` that HONOURS the where clause,
     * so the voice and status filters are genuinely exercised rather than
     * asserted against a hand-rigged return value.
     */
    function seedRenditions(
      prisma: PrismaMock,
      rows: Array<{ id: string; voiceId: string; status: string }>,
    ) {
      prisma.audioRendition.findUnique.mockImplementation(
        ({
          where,
        }: {
          where: { contentType_contentId_language_voiceId: { voiceId: string } };
        }) =>
          rows.find(
            (r) =>
              r.voiceId === where.contentType_contentId_language_voiceId.voiceId,
          ) ?? null,
      );
      prisma.audioRendition.findFirst.mockImplementation(
        ({ where }: { where: { status?: string } }) =>
          rows.find((r) => r.status === where.status) ?? null,
      );
    }

    // Prod's incumbent is Polly/Matthew (TTS_PROVIDER unset → 'polly',
    // POLLY_VOICE_ID default 'Matthew'); af_heart is the INCOMING Kokoro voice.
    // The migration fixtures below therefore run with TTS_PROVIDER=kokoro so the
    // active voice is af_heart and the leftover rows are Matthew's.
    const AFTER_FLIP = { TTS_PROVIDER: 'kokoro' };

    it('returns the active-voice rendition without falling back', async () => {
      const { service, prisma } = build();
      seedRenditions(prisma, [
        { id: 'r-active', voiceId: 'Matthew', status: 'ready' },
      ]);

      const found = await service.getRendition('digest', 'd1', 'en');

      expect(found).toEqual(expect.objectContaining({ id: 'r-active' }));
      expect(prisma.audioRendition.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to a ready rendition left by the previous voice', async () => {
      const { service, prisma } = build(AFTER_FLIP);
      // What prod looks like the moment TTS_PROVIDER flips: 302 Polly rows, none
      // yet under the new active voice.
      seedRenditions(prisma, [
        { id: 'r-polly', voiceId: 'Matthew', status: 'ready' },
      ]);

      const found = await service.getRendition('digest', 'd1', 'en');

      expect(service.voiceId).toBe('af_heart');
      expect(found).toEqual(expect.objectContaining({ id: 'r-polly' }));
      const args = prisma.audioRendition.findFirst.mock.calls[0]?.[0] as {
        where: Record<string, unknown>;
      };
      expect(args.where['status']).toBe('ready');
      expect(args.where).not.toHaveProperty('voiceId');
    });

    it('does not let a non-ready active-voice row mask a ready previous-voice one', async () => {
      const { service, prisma } = build(AFTER_FLIP);
      // Kokoro synthesis in flight while Polly audio is still serviceable.
      seedRenditions(prisma, [
        { id: 'r-kokoro', voiceId: 'af_heart', status: 'pending' },
        { id: 'r-polly', voiceId: 'Matthew', status: 'ready' },
      ]);

      const found = await service.getRendition('digest', 'd1', 'en');

      expect(found).toEqual(expect.objectContaining({ id: 'r-polly' }));
    });

    it('returns the non-ready active row when nothing ready exists, so the caller enqueues', async () => {
      const { service, prisma } = build(AFTER_FLIP);
      seedRenditions(prisma, [
        { id: 'r-kokoro', voiceId: 'af_heart', status: 'pending' },
      ]);

      const found = await service.getRendition('digest', 'd1', 'en');

      // Not 'ready', so the controller still treats this as a miss.
      expect(found).toEqual(expect.objectContaining({ status: 'pending' }));
    });

    it('returns null when the only other-voice row is PENDING, so the caller enqueues', async () => {
      const { service, prisma } = build();
      seedRenditions(prisma, [
        { id: 'r-pending', voiceId: 'af_heart', status: 'pending' },
      ]);

      await expect(service.getRendition('digest', 'd1', 'en')).resolves.toBeNull();
    });

    it('returns null when no rendition exists at all', async () => {
      const { service, prisma } = build();
      seedRenditions(prisma, []);

      await expect(service.getRendition('digest', 'd1', 'en')).resolves.toBeNull();
    });
  });

  describe('recordFailure', () => {
    const JOB = { contentType: 'digest' as const, contentId: 'd1', language: 'en' };

    it('creates a failed row carrying the classified reason', async () => {
      const { service, prisma } = build();
      prisma.audioRendition.findUnique.mockResolvedValue(null);

      await service.recordFailure(
        JOB,
        'timeout',
        'exceeded 621668ms budget for 2238 chars',
      );

      const args = prisma.audioRendition.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(args.data).toMatchObject({
        contentType: 'digest',
        contentId: 'd1',
        status: 'failed',
        failureReason: 'timeout: exceeded 621668ms budget for 2238 chars',
      });
      expect(prisma.audioRendition.update).not.toHaveBeenCalled();
    });

    it('updates an existing non-ready row instead of creating a second one', async () => {
      const { service, prisma } = build();
      prisma.audioRendition.findUnique.mockResolvedValue({
        id: 'r-1',
        status: 'pending',
      });

      await service.recordFailure(JOB, 'text_too_long', '25600 chars');

      expect(prisma.audioRendition.create).not.toHaveBeenCalled();
      const args = prisma.audioRendition.update.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(args.data).toEqual({
        status: 'failed',
        failureReason: 'text_too_long: 25600 chars',
      });
    });

    it('never downgrades a ready rendition', async () => {
      const { service, prisma } = build();
      prisma.audioRendition.findUnique.mockResolvedValue({
        id: 'r-1',
        status: 'ready',
      });

      await service.recordFailure(JOB, 'transient', 'tts-service returned 500');

      // A forced regen that fails must leave serviceable audio in circulation.
      expect(prisma.audioRendition.update).not.toHaveBeenCalled();
      expect(prisma.audioRendition.create).not.toHaveBeenCalled();
    });

    it('truncates the reason to the column width', async () => {
      const { service, prisma } = build();
      prisma.audioRendition.findUnique.mockResolvedValue(null);

      await service.recordFailure(JOB, 'permanent', 'x'.repeat(500));

      const args = prisma.audioRendition.create.mock.calls[0]?.[0] as {
        data: { failureReason: string };
      };
      expect(args.data.failureReason).toHaveLength(200);
    });
  });
});
