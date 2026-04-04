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

export class SubmitExpertVerificationDto {
  @ApiProperty({
    description: 'Type of expertise',
    enum: ['lawyer', 'law_professor', 'judge_retired', 'legal_researcher'],
  })
  @IsIn(['lawyer', 'law_professor', 'judge_retired', 'legal_researcher'])
  expertiseType!: string;

  @ApiPropertyOptional({
    description: 'Credential details (roll number, school, etc.)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  credentialDetails?: string;
}

export class ResolveExpertVerificationDto {
  @ApiProperty({
    description: 'Resolution status',
    enum: ['approved', 'rejected', 'revoked'],
  })
  @IsIn(['approved', 'rejected', 'revoked'])
  status!: string;

  @ApiPropertyOptional({ description: 'Review note' })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  reviewNote?: string;
}

export class ListExpertVerificationsQueryDto {
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
    enum: ['pending', 'approved', 'rejected', 'revoked'],
  })
  @IsIn(['pending', 'approved', 'rejected', 'revoked'])
  @IsOptional()
  status?: string;
}
