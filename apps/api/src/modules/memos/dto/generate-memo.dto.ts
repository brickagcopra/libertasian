import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateMemoDto {
  @ApiProperty({ description: 'Legal query or topic for the memo' })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  query!: string;

  @ApiProperty({
    description: 'Type of memo to generate',
    enum: ['legal_opinion', 'case_analysis', 'statutory_analysis', 'comparative', 'research_summary'],
  })
  @IsIn(['legal_opinion', 'case_analysis', 'statutory_analysis', 'comparative', 'research_summary'])
  memoType!: string;

  @ApiPropertyOptional({ description: 'Link memo to a specific matter' })
  @IsUUID()
  @IsOptional()
  matterId?: string;
}
