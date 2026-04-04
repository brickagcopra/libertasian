import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateCommunityRatingDto {
  @ApiProperty({
    description: 'Entity type',
    enum: ['flashcard_set', 'reviewer_pack', 'digest'],
  })
  @IsIn(['flashcard_set', 'reviewer_pack', 'digest'])
  entityType!: string;

  @ApiProperty({ description: 'Entity UUID' })
  @IsUUID()
  entityId!: string;

  @ApiProperty({ description: 'Rating score (1-5)', minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  score!: number;

  @ApiPropertyOptional({ description: 'Review title' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  reviewTitle?: string;

  @ApiPropertyOptional({ description: 'Review body text' })
  @IsString()
  @IsOptional()
  reviewBody?: string;
}

export class ListRatingsQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for pagination' })
  @IsUUID()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}
