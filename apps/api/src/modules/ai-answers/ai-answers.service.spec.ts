import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import { AiAnswersService, type AiAnswerResponse } from './ai-answers.service';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('AiAnswersService', () => {
  let service: AiAnswersService;
  let prismaService: jest.Mocked<PrismaService>;

  const mockRagResponse: AiAnswerResponse = {
    answer: 'Based on the Supreme Court ruling in G.R. No. 123456...',
    sources: [
      {
        document_id: 'doc-1',
        title: 'People v. Santos',
        citation_text: 'G.R. No. 123456',
        court: 'Supreme Court',
        relevance_score: 0.95,
        passage_text: 'The court held that...',
      },
    ],
    confidence: 0.88,
    abstained: false,
    model_name: 'llama-3.1-70b',
    model_version: 'v1.0',
    prompt_template_version: 'answer_v1',
    tokens_in: 2048,
    tokens_out: 512,
    latency_ms: 3200,
  };

  const mockAbstentionResponse: AiAnswerResponse = {
    answer: '',
    sources: [],
    confidence: 0.2,
    abstained: true,
    abstention_reason: 'Insufficient relevant sources found',
    model_name: 'llama-3.1-70b',
    tokens_in: 1024,
    tokens_out: 64,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAnswersService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultVal?: string) => {
              if (key === 'RAG_SERVICE_URL') return 'http://rag:8000';
              return defaultVal;
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            modelRun: {
              create: jest.fn().mockResolvedValue({ id: 'mr-1' }),
            },
          },
        },
      ],
    }).compile();

    service = module.get(AiAnswersService);
    prismaService = module.get(PrismaService);
  });

  // ---- generateAnswer ----

  describe('generateAnswer', () => {
    it('should call RAG service and return the answer', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRagResponse,
      });

      const result = await service.generateAnswer(
        { query: 'What is the rule on hearsay evidence?' },
        'user-1',
        'org-1',
      );

      expect(mockFetch).toHaveBeenCalledWith('http://rag:8000/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'What is the rule on hearsay evidence?',
          max_passages: 8,
        }),
      });

      expect(result).toEqual(mockRagResponse);
      expect(result.confidence).toBe(0.88);
      expect(result.sources).toHaveLength(1);
    });

    it('should use custom maxPassages when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRagResponse,
      });

      await service.generateAnswer(
        { query: 'test query', maxPassages: 5 },
        'user-1',
        'org-1',
      );

      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.max_passages).toBe(5);
    });

    it('should default maxPassages to 8', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRagResponse,
      });

      await service.generateAnswer(
        { query: 'test query' },
        'user-1',
        'org-1',
      );

      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.max_passages).toBe(8);
    });

    it('should record a model run in Prisma', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRagResponse,
      });

      await service.generateAnswer(
        { query: 'hearsay evidence?' },
        'user-1',
        'org-1',
      );

      // Wait for the non-blocking promise
      await new Promise((r) => setTimeout(r, 10));

      expect(prismaService.modelRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          runType: 'ai_answer',
          modelName: 'llama-3.1-70b',
          modelVersion: 'v1.0',
          promptTemplateVersion: 'answer_v1',
          inputRef: 'user:user-1:org:org-1',
          outputRef: 'answered',
          confidence: 0.88,
          tokensIn: 2048,
          tokensOut: 512,
          latencyMs: 3200,
        }),
      });
    });

    it('should record outputRef as "abstained" when AI abstains', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAbstentionResponse,
      });

      await service.generateAnswer(
        { query: 'some obscure question' },
        'user-1',
        'org-1',
      );

      await new Promise((r) => setTimeout(r, 10));

      expect(prismaService.modelRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          outputRef: 'abstained',
          confidence: 0.2,
        }),
      });
    });

    it('should throw on RAG service HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      });

      await expect(
        service.generateAnswer({ query: 'test' }, 'user-1', 'org-1'),
      ).rejects.toThrow('RAG service returned 500');
    });

    it('should handle RAG service returning 503', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'Service unavailable',
      });

      await expect(
        service.generateAnswer({ query: 'test' }, 'user-1', 'org-1'),
      ).rejects.toThrow('RAG service returned 503');
    });

    it('should handle response.text() failure gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => { throw new Error('body unavailable'); },
      });

      await expect(
        service.generateAnswer({ query: 'test' }, 'user-1', 'org-1'),
      ).rejects.toThrow('RAG service returned 502');
    });

    it('should not throw if model run recording fails', async () => {
      (prismaService.modelRun.create as jest.Mock).mockRejectedValueOnce(
        new Error('DB connection lost'),
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRagResponse,
      });

      // Should not throw — model run failure is non-blocking
      const result = await service.generateAnswer(
        { query: 'test' },
        'user-1',
        'org-1',
      );

      expect(result.answer).toBeDefined();
    });

    it('should use fallback model_name "unknown" when not provided', async () => {
      const responseWithoutModel: AiAnswerResponse = {
        ...mockRagResponse,
        model_name: undefined,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => responseWithoutModel,
      });

      await service.generateAnswer({ query: 'test' }, 'user-1', 'org-1');

      await new Promise((r) => setTimeout(r, 10));

      expect(prismaService.modelRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          modelName: 'unknown',
        }),
      });
    });

    it('should compute latencyMs from elapsed time when not in response', async () => {
      const responseWithoutLatency = { ...mockRagResponse, latency_ms: undefined };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => responseWithoutLatency,
      });

      await service.generateAnswer({ query: 'test' }, 'user-1', 'org-1');

      await new Promise((r) => setTimeout(r, 10));

      expect(prismaService.modelRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          latencyMs: expect.any(Number),
        }),
      });
    });
  });

  // ---- getStreamFetchArgs ----

  describe('getStreamFetchArgs', () => {
    it('should return correct URL and request init', () => {
      const args = service.getStreamFetchArgs({
        query: 'What is res judicata?',
      });

      expect(args.url).toBe('http://rag:8000/answer/stream');
      expect(args.init.method).toBe('POST');
      expect(args.init.headers).toEqual({
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(args.init.body as string);
      expect(body.query).toBe('What is res judicata?');
      expect(body.max_passages).toBe(8);
    });

    it('should use custom maxPassages', () => {
      const args = service.getStreamFetchArgs({
        query: 'test',
        maxPassages: 12,
      });

      const body = JSON.parse(args.init.body as string);
      expect(body.max_passages).toBe(12);
    });

    it('should default maxPassages to 8', () => {
      const args = service.getStreamFetchArgs({ query: 'test' });
      const body = JSON.parse(args.init.body as string);
      expect(body.max_passages).toBe(8);
    });
  });
});
