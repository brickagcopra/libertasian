import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';

import { AiAnswersController } from './ai-answers.controller';
import { AiAnswersService, type AiAnswerResponse } from './ai-answers.service';
import { AuditService } from '../audit/audit.service';
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
    resetsAt: new Date('2026-04-01'),
  };

  const mockQuotaExceeded = {
    allowed: false,
    used: 200,
    limit: 200,
    remaining: 0,
    resetsAt: new Date('2026-04-01'),
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
      ],
    }).compile();

    controller = module.get(AiAnswersController);
    aiAnswersService = module.get(AiAnswersService);
    auditService = module.get(AuditService);
    usageQuota = module.get(UsageQuotaService);
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
      );
    });
  });
});
