import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class ClassificationReviewQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsEnum(['needs_review', 'auto', 'confirmed', 'rejected'])
  reviewStatus?: string;

  @IsOptional()
  @IsString()
  subjectCode?: string;

  @IsOptional()
  @IsString()
  documentType?: string;
}

export class ConfirmClassificationDto {
  @IsUUID()
  documentId!: string;

  @IsUUID()
  tagId!: string;
}

export class RejectClassificationDto {
  @IsUUID()
  documentId!: string;

  @IsUUID()
  tagId!: string;
}
