import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ExternalGenerateMemoDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  query!: string;

  @IsIn([
    'legal_opinion',
    'case_analysis',
    'statutory_analysis',
    'comparative',
    'research_summary',
  ])
  memoType!: string;

  @IsUUID()
  @IsOptional()
  matterId?: string;
}
