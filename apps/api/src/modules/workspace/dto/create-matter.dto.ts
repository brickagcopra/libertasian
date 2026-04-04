import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMatterDto {
  @ApiProperty({ description: 'Matter title', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;

  @ApiPropertyOptional({ description: 'Matter description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Matter type',
    enum: ['civil', 'criminal', 'labor', 'commercial', 'administrative', 'special_proceedings', 'other'],
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  matterType?: string;

  @ApiPropertyOptional({ description: 'Court handling the case', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  court?: string;
}
