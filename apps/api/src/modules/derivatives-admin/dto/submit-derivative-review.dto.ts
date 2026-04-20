import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

const VERDICTS = ['approve', 'reject', 'needs_revision'] as const;

export class SubmitDerivativeReviewDto {
  @ApiProperty({
    description: 'Review verdict',
    enum: VERDICTS,
  })
  @IsIn([...VERDICTS])
  verdict!: string;

  @ApiPropertyOptional({ description: 'Review notes', maxLength: 5000 })
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Truthfulness score (0-1)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  truthfulnessScore?: number;

  @ApiPropertyOptional({ description: 'Completeness score (0-1)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  completenessScore?: number;

  @ApiPropertyOptional({ description: 'Citation accuracy score (0-1)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  citationAccuracyScore?: number;
}
