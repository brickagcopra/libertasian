import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../uploads/s3.service';
import { AudioRenditionService } from './audio-rendition.service';
import { PollyClient } from './polly.client';

interface PrismaMock {
  digest: { findUnique: jest.Mock };
  barExamAnswer: { findUnique: jest.Mock };
  audioRendition: { findUnique: jest.Mock; findFirst: jest.Mock; upsert: jest.Mock };
}

function build() {
  const prisma: PrismaMock = {
    digest: { findUnique: jest.fn() },
    barExamAnswer: { findUnique: jest.fn() },
    audioRendition: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const polly = { synthesize: jest.fn() };
  const s3 = { upload: jest.fn(), getSignedUrl: jest.fn() };
  const queue = { add: jest.fn() };
  const config: ConfigService = {
    get: (_key: string, def?: string): string | undefined => def,
  } as unknown as ConfigService;

  const service = new AudioRenditionService(
    prisma as unknown as PrismaService,
    polly as unknown as PollyClient,
    s3 as unknown as S3Service,
    config,
    queue as unknown as Queue,
  );
  return { service, prisma, polly, s3, queue };
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

// Two word marks + a sentence mark; last word `time` is the duration estimate.
const MARKS = Buffer.from(
  [
    '{"time":0,"type":"word","value":"People"}',
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
      const { service, prisma, polly, s3 } = build();
      prisma.digest.findUnique.mockResolvedValue(DIGEST_ROW);
      prisma.audioRendition.findFirst.mockResolvedValue(null);
      polly.synthesize.mockResolvedValue({
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

      expect(polly.synthesize).toHaveBeenCalledTimes(1);
      // SSML passed to Polly should be wrapped + expand "v." → "versus".
      const ssmlArg = polly.synthesize.mock.calls[0]?.[0] as string;
      expect(ssmlArg.startsWith('<speak>')).toBe(true);
      expect(ssmlArg).toContain('versus');

      expect(s3.upload).toHaveBeenCalledTimes(2);
      const keys = s3.upload.mock.calls.map((c) => c[0] as string);
      expect(keys).toContain('audio/digest/digest-1/Matthew-en.mp3');
      expect(keys).toContain('audio/digest/digest-1/Matthew-en.marks.json');

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
      });
      expect(upsertArg.create['charCount']).toBeGreaterThan(0);
      expect(typeof upsertArg.create['contentHash']).toBe('string');
      expect(result.id).toBe('rend-1');
    });
  });

  describe('generate — content-hash short-circuit', () => {
    it('returns the existing ready rendition without calling Polly or S3', async () => {
      const { service, prisma, polly, s3 } = build();
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
      expect(polly.synthesize).not.toHaveBeenCalled();
      expect(s3.upload).not.toHaveBeenCalled();
      expect(prisma.audioRendition.upsert).not.toHaveBeenCalled();
    });

    it('bypasses the short-circuit when force is set', async () => {
      const { service, prisma, polly, s3 } = build();
      prisma.digest.findUnique.mockResolvedValue(DIGEST_ROW);
      prisma.audioRendition.findFirst.mockResolvedValue({
        id: 'cached-1',
        status: 'ready',
      });
      polly.synthesize.mockResolvedValue({ audio: Buffer.from('x'), marks: MARKS });
      prisma.audioRendition.upsert.mockResolvedValue({ id: 'rend-2' });

      await service.generate({
        contentType: 'digest',
        contentId: 'digest-1',
        language: 'en',
        force: true,
      });

      expect(prisma.audioRendition.findFirst).not.toHaveBeenCalled();
      expect(polly.synthesize).toHaveBeenCalledTimes(1);
      expect(s3.upload).toHaveBeenCalledTimes(2);
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
        durationMs: 4200,
        language: 'en',
        voiceId: 'Matthew',
      });

      expect(model.status).toBe('ready');
      expect(model.audioUrl).toMatch(/^https:\/\/signed\.example\/.*\.mp3\?sig=/);
      expect(model.marksUrl).toMatch(/\.marks\.json\?sig=/);
      expect(model.durationMs).toBe(4200);
      expect(s3.getSignedUrl).toHaveBeenCalledWith(
        'audio/digest/d1/Matthew-en.mp3',
        300,
      );
    });

    it('returns null URLs for a non-ready rendition', async () => {
      const { service, s3 } = build();
      const model = await service.buildReadModel({
        status: 'pending',
        audioObjectKey: 'x.mp3',
        marksObjectKey: null,
        durationMs: null,
        language: 'en',
        voiceId: 'Matthew',
      });
      expect(model.audioUrl).toBeNull();
      expect(model.marksUrl).toBeNull();
      expect(s3.getSignedUrl).not.toHaveBeenCalled();
    });
  });

  describe('requestGeneration', () => {
    it('enqueues with a deterministic jobId for normal requests', async () => {
      const { service, queue } = build();
      await service.requestGeneration('digest', 'd1', 'en', false);
      const opts = queue.add.mock.calls[0]?.[2] as { jobId?: string };
      expect(opts.jobId).toBe('digest:d1:en:Matthew');
    });

    it('omits the jobId for forced regen so it always runs', async () => {
      const { service, queue } = build();
      await service.requestGeneration('digest', 'd1', 'en', true);
      const opts = queue.add.mock.calls[0]?.[2] as { jobId?: string };
      expect(opts.jobId).toBeUndefined();
    });
  });
});
