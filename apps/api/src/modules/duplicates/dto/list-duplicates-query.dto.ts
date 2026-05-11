import { IsIn, IsInt, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

const DUPLICATE_STATUSES = ['pending', 'merged', 'dismissed', 'auto_dismissed'] as const;
const SIMILARITY_TYPES = ['checksum', 'title', 'citation', 'canonical_url_match', 'exact_duplicate', 'mirror_duplicate', 'version_update', 'possible_duplicate'] as const;
const CLASSIFICATION_TIERS = ['exact_duplicate', 'canonical_url_match', 'mirror_duplicate', 'version_update', 'possible_duplicate', 'new_document'] as const;

export class ListDuplicatesQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination' })
  @IsUUID()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ default: 20 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({ enum: DUPLICATE_STATUSES })
  @IsIn(DUPLICATE_STATUSES)
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ enum: SIMILARITY_TYPES })
  @IsIn(SIMILARITY_TYPES)
  @IsOptional()
  similarityType?: string;

  @ApiPropertyOptional({ enum: CLASSIFICATION_TIERS })
  @IsIn(CLASSIFICATION_TIERS)
  @IsOptional()
  classificationTier?: string;

  @ApiPropertyOptional({ description: 'Minimum confidence score filter' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  minConfidence?: number;
}
