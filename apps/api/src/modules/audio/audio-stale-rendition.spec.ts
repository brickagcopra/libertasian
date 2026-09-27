import { ConfigService } from '@nestjs/config';
import { HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { Queue } from 'bullmq';
import { UserRole, type JwtPayload } from '@libertasian/types';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DigestsService } from '../digests/digests.service';
import { DocumentsService } from '../documents/documents.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { AudioController } from './audio.controller';
import { AudioRenditionService } from './audio-rendition.service';
import { AudioStorageService } from './audio-storage.service';
import type { TtsClient } from './tts.client';

/**
 * Stale-clip regression: section text is rewritten in place (statutory
 * realign / re-seed), so a `ready` rendition can narrate text the page no
 * longer shows. The REAL AudioRenditionService is wired into the controller
 * here — only Prisma, S3 and the BullMQ queue are faked — so the freshness
 * check, the 202 path and the job-id dedupe are exercised end to end.
 */

const SECTION = 'sec-1';

const user: JwtPayload = {
  sub: 'user-1',
  email: 'u@example.com',
  role: UserRole.STUDENT,
  organizationId: 'org-1',
  mfaVerified: true,
  iat: 0,
  exp: 0,
};

interface Row {
  status: string;
  contentHash: string;
  voiceId: string;
  audioObjectKey: string;
  marksObjectKey: string | null;
  readalongObjectKey: string | null;
  durationMs: number | null;
  language: string;
}

function build(currentText: string | null) {
  let rendition: Row | null = null;
  const prisma = {
    legalDocumentSection: {
      findUnique: jest.fn(async (args: { select: Record<string, unknown> }) => {
        // The controller's gate asks only for the parent id.
        if ('legalDocumentId' in args.select && !('plainText' in args.select)) {
          return { legalDocumentId: 'doc-1' };
        }
        return currentText === null
          ? null // deleted since the clip was made
          : {
              sectionLabel: 'Section 3.',
              sectionType: 'section',
              plainText: currentText,
              legalDocument: { title: '1987 Constitution', status: 'published' },
            };
      }),
    },
    audioRendition: {
      findUnique: jest.fn(async () => rendition),
      findFirst: jest.fn(async () => (rendition?.status === 'ready' ? rendition : null)),
    },
  };

  // A queue that remembers what it holds, so the second of two rapid plays
  // sees the first play's job still waiting.
  const jobs = new Map<string, { getState: () => Promise<string> }>();
  const queue = {
    add: jest.fn(async (_name: string, _data: unknown, opts: { jobId?: string }) => {
      if (opts.jobId) jobs.set(opts.jobId, { getState: async () => 'waiting' });
    }),
    getJob: jest.fn(async (id: string) => jobs.get(id) ?? null),
  };
  const s3 = {
    getSignedUrl: jest.fn(async (key: string) => `https://signed/${key}`),
  };
  const config = {
    get: (_key: string, def?: string): string | undefined => def,
  } as unknown as ConfigService;

  const renditions = new AudioRenditionService(
    prisma as unknown as PrismaService,
    { synthesize: jest.fn() } as unknown as TtsClient,
    s3 as unknown as AudioStorageService,
    config,
    queue as unknown as Queue,
  );
  const controller = new AudioController(
    renditions,
    {} as unknown as DigestsService,
    { getSection: jest.fn() } as unknown as DocumentsService,
    {
      resolveEffectiveEntitlements: jest.fn().mockResolvedValue({ previewOnly: false }),
    } as unknown as EntitlementService,
    {} as unknown as AuditService,
    prisma as unknown as PrismaService,
  );

  const setRendition = (contentHash: string) => {
    rendition = {
      status: 'ready',
      contentHash,
      voiceId: renditions.voiceId,
      audioObjectKey: 'audio/sec-1.mp3',
      marksObjectKey: null,
      readalongObjectKey: 'audio/sec-1.readalong.json',
      durationMs: 4200,
      language: 'en',
    };
  };

  const play = async () => {
    const status = jest.fn();
    const out = await controller.getRendition(
      'legal_document_section',
      SECTION,
      'en',
      user,
      { status } as unknown as Response,
    );
    return { out, status };
  };

  return { renditions, queue, prisma, setRendition, play };
}

describe('audio read path — stale renditions', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('serves a ready clip whose hash matches the current text (200 ready)', async () => {
    const { renditions, queue, setRendition, play } = build('Current text.');
    setRendition(await renditions.currentContentHash('legal_document_section', SECTION));

    const { out, status } = await play();

    expect(status).not.toHaveBeenCalled();
    expect(out.data.status).toBe('ready');
    expect(out.data.audioUrl).toBe('https://signed/audio/sec-1.mp3');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('answers 202 pending and enqueues once when the text changed', async () => {
    // The clip was synthesized from the old text; the section now reads differently.
    const oldHash = await build('Old text.').renditions.currentContentHash(
      'legal_document_section',
      SECTION,
    );
    const { queue, setRendition, play } = build('New text.');
    setRendition(oldHash);

    const { out, status } = await play();

    expect(status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
    expect(out.data.status).toBe('pending');
    expect(out.data.audioUrl).toBeNull();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        contentType: 'legal_document_section',
        contentId: SECTION,
        force: false,
      }),
      expect.objectContaining({ jobId: expect.any(String) }),
    );
  });

  it('enqueues only once for two rapid plays of a stale clip', async () => {
    const { queue, setRendition, play } = build('New text.');
    setRendition('hash-of-the-old-text');

    const first = await play();
    const second = await play();

    expect(first.out.data.status).toBe('pending');
    expect(second.out.data.status).toBe('pending');
    expect(second.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('does not serve a stale any-voice fallback either', async () => {
    const { renditions, prisma } = build('New text.');
    const pendingActive = { status: 'pending', contentHash: '', voiceId: renditions.voiceId };
    prisma.audioRendition.findUnique.mockResolvedValue(pendingActive as never);
    prisma.audioRendition.findFirst.mockResolvedValue({
      status: 'ready',
      contentHash: 'hash-of-the-old-text',
      voiceId: 'Matthew',
    } as never);

    const found = await renditions.getRendition('legal_document_section', SECTION, 'en');

    // The non-ready active row comes back, so the controller enqueues.
    expect(found).toBe(pendingActive);
  });

  it('serves a fresh any-voice fallback', async () => {
    const { renditions, prisma } = build('Text.');
    const hash = await renditions.currentContentHash('legal_document_section', SECTION);
    const fallback = { status: 'ready', contentHash: hash, voiceId: 'Matthew' };
    prisma.audioRendition.findUnique.mockResolvedValue(null as never);
    prisma.audioRendition.findFirst.mockResolvedValue(fallback as never);

    await expect(
      renditions.getRendition('legal_document_section', SECTION, 'en'),
    ).resolves.toBe(fallback);
  });

  it('keeps serving (200 + warning, no enqueue) when the text cannot be read', async () => {
    const { queue, setRendition, play } = build(null);
    setRendition('hash-of-text-that-is-gone');

    const { out, status } = await play();

    expect(status).not.toHaveBeenCalled();
    expect(out.data.status).toBe('ready');
    expect(queue.add).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Cannot read current text'));
  });
});
