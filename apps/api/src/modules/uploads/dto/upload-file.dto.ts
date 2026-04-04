import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class UploadFileDto {
  @ApiPropertyOptional({
    description: 'Privacy level for the upload',
    enum: ['private', 'editorial_candidate'],
    default: 'private',
  })
  @IsOptional()
  @IsString()
  @IsIn(['private', 'editorial_candidate'])
  privacyLevel?: string;
}
