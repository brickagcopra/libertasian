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

export class CreateCommunityFlagDto {
  @ApiProperty({
    description: 'Entity type',
    enum: ['flashcard_set', 'reviewer_pack', 'digest', 'community_rating'],
  })
  @IsIn(['flashcard_set', 'reviewer_pack', 'digest', 'community_rating'])
  entityType!: string;

  @ApiProperty({ description: 'Entity UUID' })
  @IsUUID()
  entityId!: string;

  @ApiProperty({
    description: 'Reason for flagging',
    enum: ['spam', 'inappropriate', 'copyright', 'inaccurate', 'other'],
  })
  @IsIn(['spam', 'inappropriate', 'copyright', 'inaccurate', 'other'])
  reason!: string;

  @ApiPropertyOptional({ description: 'Additional details' })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  details?: string;
}

export class ResolveCommunityFlagDto {
  @ApiProperty({
    description: 'Resolution status',
    enum: ['dismissed', 'actioned'],
  })
  @IsIn(['dismissed', 'actioned'])
  status!: string;

  @ApiPropertyOptional({ description: 'Resolution note' })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  resolutionNote?: string;
}

export class ListFlagsQueryDto {
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

  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: ['open', 'dismissed', 'actioned'],
  })
  @IsIn(['open', 'dismissed', 'actioned'])
  @IsOptional()
  status?: string;
}
