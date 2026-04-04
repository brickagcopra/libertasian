import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CitationSearchDto {
  @ApiProperty({ description: 'Exact citation text (G.R. No., RA No., etc.)' })
  @IsString()
  @MaxLength(500)
  citation!: string;
}
