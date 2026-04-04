import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateTimelineDto {
  @ApiProperty({
    description: 'Title for the timeline (3-500 characters)',
    minLength: 3,
    maxLength: 500,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  title!: string;

  @ApiProperty({
    description: 'UUIDs of legal documents to extract timeline events from (1-10)',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  documentIds!: string[];

  @ApiPropertyOptional({ description: 'Link timeline to a specific matter' })
  @IsUUID()
  @IsOptional()
  matterId?: string;
}
