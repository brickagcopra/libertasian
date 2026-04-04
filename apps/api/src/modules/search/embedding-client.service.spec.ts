import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { EmbeddingClientService } from './embedding-client.service';

describe('EmbeddingClientService', () => {
  let service: EmbeddingClientService;
  const baseUrl = 'http://localhost:8001';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddingClientService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultVal?: unknown) => {
              if (key === 'EMBEDDING_SERVICE_URL') return baseUrl;
              return defaultVal;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<EmbeddingClientService>(EmbeddingClientService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('onModuleInit', () => {
    it('should log success when embedding service is reachable', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
      } as Response);

      await service.onModuleInit();

      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/health`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('should warn when embedding service is not reachable', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

      // Should not throw
      await service.onModuleInit();
    });

    it('should handle non-ok response on health check', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);

      // Should not throw
      await service.onModuleInit();
    });
  });

  describe('embed', () => {
    it('should return embedding vector for a single text', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4];
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embedding: mockEmbedding,
          model_name: 'bge-m3',
          dimension: 4,
        }),
      } as Response);

      const result = await service.embed('Article 1191 of the Civil Code');

      expect(result).toEqual(mockEmbedding);
      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/embed`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'Article 1191 of the Civil Code' }),
        }),
      );
    });

    it('should return null when service returns non-ok response', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const result = await service.embed('test query');

      expect(result).toBeNull();
    });

    it('should return null when fetch throws (service unavailable)', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await service.embed('test query');

      expect(result).toBeNull();
    });

    it('should use 30s timeout for embed requests', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: [0.1], model_name: 'test', dimension: 1 }),
      } as Response);

      await service.embed('test');

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  describe('embedBatch', () => {
    it('should return empty array for empty input', async () => {
      const result = await service.embedBatch([]);
      expect(result).toEqual([]);
    });

    it('should return embedding vectors for multiple texts', async () => {
      const mockEmbeddings = [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]];
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embeddings: mockEmbeddings,
          model_name: 'bge-m3',
          dimension: 2,
          count: 3,
        }),
      } as Response);

      const texts = ['text 1', 'text 2', 'text 3'];
      const result = await service.embedBatch(texts);

      expect(result).toEqual(mockEmbeddings);
      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/embed/batch`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ texts }),
        }),
      );
    });

    it('should return null when batch service returns non-ok', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 422,
      } as Response);

      const result = await service.embedBatch(['text']);
      expect(result).toBeNull();
    });

    it('should return null when batch fetch throws', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('timeout'));

      const result = await service.embedBatch(['text']);
      expect(result).toBeNull();
    });

    it('should use 60s timeout for batch requests', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [[0.1]], model_name: 'test', dimension: 1, count: 1 }),
      } as Response);

      await service.embedBatch(['test']);

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  describe('isAvailable', () => {
    it('should return true when health check passes', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
      } as Response);

      const result = await service.isAvailable();
      expect(result).toBe(true);
    });

    it('should return false when health check returns non-ok', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);

      const result = await service.isAvailable();
      expect(result).toBe(false);
    });

    it('should return false when health check throws', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await service.isAvailable();
      expect(result).toBe(false);
    });
  });
});
