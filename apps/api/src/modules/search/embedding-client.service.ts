import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface EmbedResponse {
  embedding: number[];
  model_name: string;
  dimension: number;
}

interface BatchEmbedResponse {
  embeddings: number[][];
  model_name: string;
  dimension: number;
  count: number;
}

/**
 * Client for the embedding service (Python FastAPI at EMBEDDING_SERVICE_URL).
 * Per PDD Section 4.5: embedding model produces 1024-dim vectors for kNN search.
 */
@Injectable()
export class EmbeddingClientService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingClientService.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>(
      'EMBEDDING_SERVICE_URL',
      'http://localhost:8001',
    );
  }

  async onModuleInit() {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        this.logger.log(`Embedding service connected at ${this.baseUrl}`);
      }
    } catch {
      this.logger.warn(
        `Embedding service not available at ${this.baseUrl} — vector search will be disabled`,
      );
    }
  }

  /**
   * Embed a single text string. Returns a 1024-dim vector.
   */
  async embed(text: string): Promise<number[] | null> {
    try {
      const response = await fetch(`${this.baseUrl}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        this.logger.warn(`Embedding service returned ${response.status}`);
        return null;
      }

      const data = (await response.json()) as EmbedResponse;
      return data.embedding;
    } catch (err) {
      this.logger.warn(
        `Embedding request failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return null;
    }
  }

  /**
   * Embed multiple texts in a single batch call. Returns array of 1024-dim vectors.
   * Max 256 texts per batch per embedding service schema.
   */
  async embedBatch(texts: string[]): Promise<number[][] | null> {
    if (texts.length === 0) return [];

    try {
      const response = await fetch(`${this.baseUrl}/embed/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        this.logger.warn(`Batch embedding service returned ${response.status}`);
        return null;
      }

      const data = (await response.json()) as BatchEmbedResponse;
      return data.embeddings;
    } catch (err) {
      this.logger.warn(
        `Batch embedding request failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return null;
    }
  }

  /**
   * Check if the embedding service is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
