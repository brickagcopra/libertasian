import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMatterDto {
  @ApiPropertyOptional({ description: 'Matter title', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ description: 'Matter description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Matter type' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  matterType?: string;

  @ApiPropertyOptional({ description: 'Court handling the case', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  court?: string;

  @ApiPropertyOptional({
    description: 'Matter status',
    enum: ['active', 'closed', 'archived'],
  })
  @IsOptional()
  @IsString()
  @IsEnum(['active', 'closed', 'archived'])
  status?: string;
}
