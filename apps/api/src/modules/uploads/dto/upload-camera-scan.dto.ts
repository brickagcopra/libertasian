import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class UploadCameraScanDto {
  @ApiPropertyOptional({
    description: 'Device platform',
    enum: ['ios', 'android'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['ios', 'android'])
  devicePlatform?: string;

  @ApiProperty({
    description: 'Capture mode',
    enum: ['single_page', 'multi_page'],
    default: 'single_page',
  })
  @IsOptional()
  @IsString()
  @IsIn(['single_page', 'multi_page'])
  captureMode?: string;

  @ApiPropertyOptional({
    description: 'Privacy level for the scan',
    enum: ['private', 'editorial_candidate'],
    default: 'private',
  })
  @IsOptional()
  @IsString()
  @IsIn(['private', 'editorial_candidate'])
  privacyLevel?: string;
}
