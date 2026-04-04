import { IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GeneratePleadingDto {
  @ApiProperty({ description: 'UUID of the pleading template to use' })
  @IsUUID()
  templateId!: string;

  @ApiProperty({
    description: 'Input data matching the template sections (key-value pairs)',
    type: Object,
  })
  @IsObject()
  inputData!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Additional context or instructions for the AI generation',
  })
  @IsString()
  @IsOptional()
  @MinLength(5)
  @MaxLength(2000)
  contextQuery?: string;

  @ApiPropertyOptional({ description: 'Link pleading to a specific matter' })
  @IsUUID()
  @IsOptional()
  matterId?: string;
}
