import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Bounds mirror the strict request model of rag-service's POST /research/deep
 * (question 1..2000 chars): anything that
 * slipped past here would fail upstream as a 422 mid-stream, after the quota
 * unit was already spent.
 */
export class DeepResearchStreamDto {
  @ApiProperty({ minLength: 3, maxLength: 2000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  question!: string;

  /**
   * Forwarded as `model_override`. The gateway does not decide which models
   * are allowed: rag-service accepts it only when it is listed in
   * DEEP_RESEARCH_MODEL_ALLOWLIST, so the allowlist lives in one place.
   */
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._:-]+$/, { message: 'modelOverride is not a model name' })
  modelOverride?: string;
}
