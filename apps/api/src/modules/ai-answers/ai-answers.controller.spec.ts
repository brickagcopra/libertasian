import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { AiAnswersController } from './ai-answers.controller';
import { AiAnswersService, type AiAnswerResponse } from './ai-answers.service';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { PaywallException } from '../../common/exceptions/paywall.exception';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import type { JwtPayload } from '@libertasian/types';

// Mock global fetch for SSE streaming tests
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('AiAnswersController', () => {
  let controller: AiAnswersController;
  let aiAnswersService: jest.Mocked<AiAnswersService>;
  let auditService: jest.Mocked<AuditService>;
  let usageQuota: jest.Mocked<UsageQuotaService>;
  let documents: jest.Mocked<DocumentsService>;
  let entitlements: jest.Mocked<EntitlementService>;

  const DOC_ID = '11111111-1111-4111-8111-111111111111';

  const mockUser: JwtPayload = {
    sub: 'user-1',
    email: 'test@example.com',
    role: 'member' as never,
    organizationId: 'org-1',
    mfaVerified: true,
    iat: 0,
    exp: 0,
  };

  const mockAnswerResult: AiAnswerResponse = {
    answer: 'The Supreme Court held that...',
    sources: [
      {
        document_id: 'doc-1',
        title: 'People v. Santos',
        citation_text: 'G.R. No. 123456',
        relevance_score: 0.95,
        passage_text: 'Relevant passage...',
      },
    ],
    confidence: 0.9,
    abstained: false,
    model_name: 'llama-3.1-70b',
  };

  const mockQuotaAllowed = {
    allowed: true,
    used: 5,
    limit: 200,
    remaining: 195,
    resetsAt: '2026-04-01T00:00:00.000Z',
  };

  const mockQuotaExceeded = {
    allowed: false,
    used: 200,
    limit: 200,
    remaining: 0,
    resetsAt: '2026-04-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiAnswersController],
      providers: [
        {
          provide: AiAnswersService,
          useValue: {
            generateAnswer: jest.fn(),
            getStreamFetchArgs: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: UsageQuotaService,
          useValue: {
            checkAndIncrement: jest.fn(),
          },
        },
        {
          provide: DocumentsService,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: EntitlementService,
          useValue: {
            resolveEffectiveEntitlements: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AiAnswersController);
    aiAnswersService = module.get(AiAnswersService);
    auditService = module.get(AuditService);
    usageQuota = module.get(UsageQuotaService);
    documents = module.get(DocumentsService);
    entitlements = module.get(EntitlementService);

    // Default: a paying org, and the document read gate lets the caller through.
    entitlements.resolveEffectiveEntitlements.mockResolvedValue({
      previewOnly: false,
    } as never);
    documents.findById.mockResolvedValue({ id: DOC_ID } as never);
  });

  // ---- generateAnswer (POST /ai-answers) ----

  describe('generateAnswer', () => {
    it('should return AI answer with quota meta', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.generateAnswer.mockResolvedValueOnce(mockAnswerResult);

      const result = await controller.generateAnswer(
        { query: 'What is res judicata?' },
        mockUser,
      );

      expect(result).toEqual({
        success: true,
        data: mockAnswerResult,
        meta: {
          quota: { used: 5, limit: 200, remaining: 195 },
        },
      });
    });

    it('should check quota before generating', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.generateAnswer.mockResolvedValueOnce(mockAnswerResult);

      await controller.generateAnswer({ query: 'test' }, mockUser);

      expect(usageQuota.checkAndIncrement).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'aiAnswers',
        { isPlatformAdmin: false },
      );
    });

    it('should throw ForbiddenException when quota exceeded', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaExceeded);

      await expect(
        controller.generateAnswer({ query: 'test' }, mockUser),
      ).rejects.toThrow(ForbiddenException);

      // Service should not be called
      expect(aiAnswersService.generateAnswer).not.toHaveBeenCalled();
    });

    it('should pass query and user info to service', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.generateAnswer.mockResolvedValueOnce(mockAnswerResult);

      await controller.generateAnswer(
        { query: 'hearsay rule', maxPassages: 10 },
        mockUser,
      );

      expect(aiAnswersService.generateAnswer).toHaveBeenCalledWith(
        { query: 'hearsay rule', maxPassages: 10 },
        'user-1',
        'org-1',
      );
    });

    it('should create an audit log entry', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.generateAnswer.mockResolvedValueOnce(mockAnswerResult);

      await controller.generateAnswer(
        { query: 'burden of proof?' },
        mockUser,
      );

      expect(auditService.log).toHaveBeenCalledWith({
        organizationId: 'org-1',
        actorUserId: 'user-1',
        actorType: 'user',
        action: 'ai.answer.generate',
        entityType: 'ai_answer',
        metadata: {
          query: 'burden of proof?',
          abstained: false,
          confidence: 0.9,
          sourceCount: 1,
        },
      });
    });

    it('should log abstention metadata when AI abstains', async () => {
      const abstainedResult: AiAnswerResponse = {
        answer: '',
        sources: [],
        confidence: 0.15,
        abstained: true,
        abstention_reason: 'Not enough sources',
      };

      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.generateAnswer.mockResolvedValueOnce(abstainedResult);

      await controller.generateAnswer({ query: 'obscure topic' }, mockUser);

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            abstained: true,
            confidence: 0.15,
            sourceCount: 0,
          }),
        }),
      );
    });
  });

  // ---- streamAnswer (POST /ai-answers/stream) ----

  describe('streamAnswer', () => {
    function createMockResponse() {
      return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      } as unknown as jest.Mocked<import('express').Response>;
    }

    it('should set SSE headers', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.getStreamFetchArgs.mockReturnValueOnce({
        url: 'http://rag:8000/answer/stream',
        init: { method: 'POST', body: '{}' },
      });

      // Mock upstream with a readable stream that finishes immediately
      const mockReader = {
        read: jest.fn().mockResolvedValueOnce({ done: true, value: undefined }),
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const res = createMockResponse();
      await controller.streamAnswer({ query: 'test' }, mockUser, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
      expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
      expect(res.flushHeaders).toHaveBeenCalled();
    });

    it('should pipe upstream SSE chunks to client', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.getStreamFetchArgs.mockReturnValueOnce({
        url: 'http://rag:8000/answer/stream',
        init: { method: 'POST', body: '{}' },
      });

      const encoder = new TextEncoder();
      const chunk1 = encoder.encode('data: {"type":"token","text":"Hello"}\n\n');
      const chunk2 = encoder.encode('data: {"type":"done"}\n\n');
      const mockReader = {
        read: jest.fn()
          .mockResolvedValueOnce({ done: false, value: chunk1 })
          .mockResolvedValueOnce({ done: false, value: chunk2 })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const res = createMockResponse();
      await controller.streamAnswer({ query: 'test' }, mockUser, res);

      expect(res.write).toHaveBeenCalledTimes(2);
      expect(res.end).toHaveBeenCalled();
    });

    it('should return 403 JSON when quota exceeded', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaExceeded);

      const res = createMockResponse();
      await controller.streamAnswer({ query: 'test' }, mockUser, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'AI answer quota exceeded',
          quota: expect.objectContaining({ used: 200, limit: 200 }),
        }),
      );

      // Should not set SSE headers
      expect(res.setHeader).not.toHaveBeenCalled();
    });

    it('should handle upstream HTTP error gracefully', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.getStreamFetchArgs.mockReturnValueOnce({
        url: 'http://rag:8000/answer/stream',
        init: { method: 'POST', body: '{}' },
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      });

      const res = createMockResponse();
      await controller.streamAnswer({ query: 'test' }, mockUser, res);

      expect(res.write).toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"'),
      );
      expect(res.end).toHaveBeenCalled();
    });

    it('should handle missing upstream body', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.getStreamFetchArgs.mockReturnValueOnce({
        url: 'http://rag:8000/answer/stream',
        init: { method: 'POST', body: '{}' },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: null,
      });

      const res = createMockResponse();
      await controller.streamAnswer({ query: 'test' }, mockUser, res);

      expect(res.write).toHaveBeenCalledWith(
        expect.stringContaining('No stream body'),
      );
      expect(res.end).toHaveBeenCalled();
    });

    it('should handle upstream read error', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.getStreamFetchArgs.mockReturnValueOnce({
        url: 'http://rag:8000/answer/stream',
        init: { method: 'POST', body: '{}' },
      });

      const mockReader = {
        read: jest.fn().mockRejectedValueOnce(new Error('Connection reset')),
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const res = createMockResponse();
      await controller.streamAnswer({ query: 'test' }, mockUser, res);

      expect(res.write).toHaveBeenCalledWith(
        expect.stringContaining('Stream interrupted'),
      );
      expect(res.end).toHaveBeenCalled();
    });

    it('should log audit entry for successful stream', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.getStreamFetchArgs.mockReturnValueOnce({
        url: 'http://rag:8000/answer/stream',
        init: { method: 'POST', body: '{}' },
      });

      const mockReader = {
        read: jest.fn().mockResolvedValueOnce({ done: true, value: undefined }),
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const res = createMockResponse();
      await controller.streamAnswer(
        { query: 'res judicata' },
        mockUser,
        res,
      );

      expect(auditService.log).toHaveBeenCalledWith({
        organizationId: 'org-1',
        actorUserId: 'user-1',
        actorType: 'user',
        action: 'ai.answer.stream',
        entityType: 'ai_answer',
        metadata: { query: 'res judicata' },
      });
    });

    it('should check quota with correct parameters', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.getStreamFetchArgs.mockReturnValueOnce({
        url: 'http://rag:8000/answer/stream',
        init: { method: 'POST', body: '{}' },
      });

      const mockReader = {
        read: jest.fn().mockResolvedValueOnce({ done: true, value: undefined }),
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const res = createMockResponse();
      await controller.streamAnswer({ query: 'test' }, mockUser, res);

      expect(usageQuota.checkAndIncrement).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'aiAnswers',
        { isPlatformAdmin: false },
      );
    });
  });

  // ---- documentId authorization ----

  describe('documentId authorization', () => {
    /**
     * documentId arrives in the request body, so it is attacker-controlled.
     * These specs pin the gate: the caller's right to READ the document is
     * checked before it is ever forwarded as a retrieval scope.
     */

    /**
     * Deliberately NOT cast here. Returning `as never` would erase the
     * jest.Mock members, and the assertions below read them
     * (`expect(res.setHeader).not.toHaveBeenCalled()`). The cast belongs at the
     * `streamAnswer` call sites, where only Express's `Response` shape is
     * needed.
     */
    function createRes() {
      return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
    }

    it('authorizes the document via the documents read gate before answering', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.generateAnswer.mockResolvedValueOnce(mockAnswerResult);

      await controller.generateAnswer(
        { query: 'What does this say about bail?', documentId: DOC_ID },
        mockUser,
      );

      expect(documents.findById).toHaveBeenCalledWith(DOC_ID, false);
    });

    it('does not touch the documents gate when no documentId is supplied', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.generateAnswer.mockResolvedValueOnce(mockAnswerResult);

      await controller.generateAnswer({ query: 'What is res judicata?' }, mockUser);

      expect(documents.findById).not.toHaveBeenCalled();
    });

    it('propagates 404 for a document that does not exist', async () => {
      documents.findById.mockRejectedValueOnce(
        new NotFoundException('Legal document not found'),
      );

      await expect(
        controller.generateAnswer({ query: 'anything', documentId: DOC_ID }, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('propagates 402 for a document outside a preview-only caller’s allowance', async () => {
      entitlements.resolveEffectiveEntitlements.mockResolvedValue({
        previewOnly: true,
      } as never);
      documents.findById.mockRejectedValueOnce(
        new PaywallException({ corpus: 'documents' }),
      );

      await expect(
        controller.generateAnswer({ query: 'anything', documentId: DOC_ID }, mockUser),
      ).rejects.toThrow(PaywallException);

      expect(documents.findById).toHaveBeenCalledWith(DOC_ID, true);
    });

    it('never reaches the RAG service when authorization fails', async () => {
      documents.findById.mockRejectedValueOnce(new NotFoundException());

      await expect(
        controller.generateAnswer({ query: 'anything', documentId: DOC_ID }, mockUser),
      ).rejects.toThrow();

      expect(aiAnswersService.generateAnswer).not.toHaveBeenCalled();
    });

    it('does not consume quota when authorization fails', async () => {
      // checkAndIncrement is a consuming call, so an unauthorized request must
      // not reach it — otherwise probing for documents burns the caller's quota.
      documents.findById.mockRejectedValueOnce(new NotFoundException());

      await expect(
        controller.generateAnswer({ query: 'anything', documentId: DOC_ID }, mockUser),
      ).rejects.toThrow();

      expect(usageQuota.checkAndIncrement).not.toHaveBeenCalled();
    });

    it('resolves preview-only from entitlements for a normal member', async () => {
      entitlements.resolveEffectiveEntitlements.mockResolvedValue({
        previewOnly: true,
      } as never);
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.generateAnswer.mockResolvedValueOnce(mockAnswerResult);

      await controller.generateAnswer({ query: 'q', documentId: DOC_ID }, mockUser);

      expect(entitlements.resolveEffectiveEntitlements).toHaveBeenCalledWith('org-1');
      expect(documents.findById).toHaveBeenCalledWith(DOC_ID, true);
    });

    it('treats a platform admin as never preview-only', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.generateAnswer.mockResolvedValueOnce(mockAnswerResult);

      await controller.generateAnswer(
        { query: 'q', documentId: DOC_ID },
        { ...mockUser, isPlatformAdmin: true } as JwtPayload,
      );

      expect(entitlements.resolveEffectiveEntitlements).not.toHaveBeenCalled();
      expect(documents.findById).toHaveBeenCalledWith(DOC_ID, false);
    });

    // ---- streaming path ----

    it('authorizes the document on the streaming path too', async () => {
      usageQuota.checkAndIncrement.mockResolvedValueOnce(mockQuotaAllowed);
      aiAnswersService.getStreamFetchArgs.mockReturnValueOnce({
        url: 'http://rag/answer/stream',
        init: {},
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => ({ read: jest.fn().mockResolvedValue({ done: true }) }) },
      });

      const res = createRes();
      await controller.streamAnswer(
        { query: 'q', documentId: DOC_ID },
        mockUser,
        res as never,
      );

      expect(documents.findById).toHaveBeenCalledWith(DOC_ID, false);
    });

    it('rejects the stream before any SSE header is written', async () => {
      // The throw must land before flushHeaders(), so the client gets a normal
      // JSON error rather than an error frame inside an already-open stream.
      documents.findById.mockRejectedValueOnce(new NotFoundException());

      const res = createRes();
      await expect(
        controller.streamAnswer({ query: 'q', documentId: DOC_ID }, mockUser, res as never),
      ).rejects.toThrow(NotFoundException);

      expect(res.setHeader).not.toHaveBeenCalled();
      expect(res.flushHeaders).not.toHaveBeenCalled();
      expect(usageQuota.checkAndIncrement).not.toHaveBeenCalled();
    });
  });
});
