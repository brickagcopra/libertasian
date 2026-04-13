import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Input DTO for `DerivativeArtifactService.createBarExamSitting`.
 *
 * Creates a reference row for a specific bar exam administration (year,
 * part, subject). The `@@unique([year, part, subjectStudyCode])` constraint
 * prevents duplicates — the service catches the P2002 and surfaces it as a
 * `ConflictException`.
 */
export class CreateBarExamSittingDto {
  @ApiProperty({ description: 'Bar exam year (1901–2100)' })
  @IsInt()
  @Min(1901)
  @Max(2100)
  year!: number;

  @ApiPropertyOptional({
    description: 'Part/session identifier (e.g., "Day 1 AM", "remedial-I")',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  part?: string;

  @ApiPropertyOptional({
    description: 'Subject code under the study_8 taxonomy (e.g., "remedial_law")',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  subjectStudyCode?: string;

  @ApiPropertyOptional({
    description: 'Subject code under the bar_admin_6 taxonomy',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  subjectBarAdminCode?: string;

  @ApiPropertyOptional({ description: 'Bar exam committee chairperson' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  chairperson?: string;

  @ApiPropertyOptional({ description: 'UUID of the ingested exam paper LegalDocument' })
  @IsOptional()
  @IsUUID()
  sourceDocumentId?: string;

  @ApiPropertyOptional({ description: 'URL to the original exam paper source' })
  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @ApiProperty({
    description: 'Taxonomy version (e.g., "study_8", "bar_admin_6")',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  taxonomyVersion!: string;
}
