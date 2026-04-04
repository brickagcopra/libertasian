import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * DTO for attaching an upload (scan/document) to a workspace matter.
 * Creates a MatterDocument junction record linking the upload to the matter.
 */
export class AttachToMatterDto {
  @IsUUID()
  matterId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  @IsIn(['reference', 'exhibit', 'pleading', 'evidence', 'supporting'])
  role?: string;
}
