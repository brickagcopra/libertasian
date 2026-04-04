import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpsertStudyProgressDto {
  @ApiProperty({
    description: 'Progress status',
    enum: ['not_started', 'in_progress', 'completed'],
  })
  @IsIn(['not_started', 'in_progress', 'completed'])
  status!: string;

  @ApiPropertyOptional({ description: 'Progress percentage (0-100)', default: 0 })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  progressPct?: number;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsOptional()
  metadataJson?: Record<string, unknown>;
}

export class StudyProgressEntityParamDto {
  @ApiProperty({
    description: 'Entity type',
    enum: ['flashcard_set', 'reviewer_pack', 'codal', 'digest'],
  })
  @IsIn(['flashcard_set', 'reviewer_pack', 'codal', 'digest'])
  entityType!: string;

  @ApiProperty({ description: 'Entity ID' })
  @IsString()
  entityId!: string;
}
