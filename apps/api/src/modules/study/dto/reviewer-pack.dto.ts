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

export class CreateReviewerPackDto {
  @ApiProperty({ description: 'Title of the reviewer pack' })
  @IsString()
  @MaxLength(500)
  title!: string;

  @ApiPropertyOptional({ description: 'Description of the pack' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Bar subject code' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  barSubject?: string;

  @ApiPropertyOptional({ description: 'Topic within the bar subject' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  topic?: string;

  @ApiPropertyOptional({
    description: 'Visibility level',
    enum: ['private', 'org', 'public_editorial'],
    default: 'private',
  })
  @IsIn(['private', 'org', 'public_editorial'])
  @IsOptional()
  visibility?: string;
}

export class UpdateReviewerPackDto {
  @ApiPropertyOptional({ description: 'Title of the reviewer pack' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ description: 'Description of the pack' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Bar subject code' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  barSubject?: string;

  @ApiPropertyOptional({ description: 'Topic within the bar subject' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  topic?: string;

  @ApiPropertyOptional({
    description: 'Visibility level',
    enum: ['private', 'org', 'public_editorial'],
  })
  @IsIn(['private', 'org', 'public_editorial'])
  @IsOptional()
  visibility?: string;
}

export class ListReviewerPacksQueryDto {
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

  @ApiPropertyOptional({ description: 'Filter by bar subject code' })
  @IsString()
  @IsOptional()
  barSubject?: string;

  @ApiPropertyOptional({
    description: 'Filter by visibility',
    enum: ['private', 'org', 'public_editorial'],
  })
  @IsIn(['private', 'org', 'public_editorial'])
  @IsOptional()
  visibility?: string;
}
