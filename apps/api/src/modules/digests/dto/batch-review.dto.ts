import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class BatchApproveDto {
  @ApiProperty({ description: 'Digest IDs to approve', type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  digestIds!: string[];

  @ApiPropertyOptional({ description: 'Approval notes', maxLength: 5000 })
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  notes?: string;
}

export class BatchRejectDto {
  @ApiProperty({ description: 'Digest IDs to reject', type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  digestIds!: string[];

  @ApiPropertyOptional({ description: 'Rejection notes', maxLength: 5000 })
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Rejection reason' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  reason?: string;
}

export class BatchAssignDto {
  @ApiProperty({ description: 'Digest IDs to assign', type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  digestIds!: string[];

  @ApiProperty({ description: 'UUID of the reviewer to assign' })
  @IsUUID()
  reviewerUserId!: string;
}
