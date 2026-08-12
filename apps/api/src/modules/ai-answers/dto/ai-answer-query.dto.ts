import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Bounds mirror `AnswerRequest` in the RAG service
 * (`services/rag-service/src/answer/schemas.py`). That model is
 * `ConfigDict(strict=True)` and enforces the same limits, so anything slipping
 * past here fails upstream as a 422 the client cannot act on — validating at
 * the gateway turns that into a 400 naming the offending field.
 */
export const MAX_HISTORY_TURNS = 20;
export const MAX_HISTORY_CONTENT_CHARS = 4000;

export class ConversationTurnDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_HISTORY_CONTENT_CHARS)
  content!: string;
}

export class AiAnswerQueryDto {
  @IsString()
  @MaxLength(2000)
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxPassages?: number;

  /**
   * Restrict retrieval to a single legal document.
   *
   * Client-supplied, so the controller verifies the caller may actually read it
   * before this reaches the RAG service. `LegalDocument.id` is `@db.Uuid`, and
   * rejecting a malformed id here keeps it out of the entitlement lookup.
   */
  @IsOptional()
  @IsUUID()
  documentId?: string;

  /**
   * Prior conversation turns, oldest first. Forwarded for prompt continuity
   * only — the RAG service never lets history influence retrieval.
   *
   * Bounded because the whole transcript is replayed into the generation
   * prompt: an unbounded one is a cost and token-budget hole that would crowd
   * out the source passages the answer has to be grounded in.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_HISTORY_TURNS)
  @ValidateNested({ each: true })
  @Type(() => ConversationTurnDto)
  history?: ConversationTurnDto[];
}
