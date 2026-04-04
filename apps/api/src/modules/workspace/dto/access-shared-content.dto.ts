import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AccessSharedContentDto {
  @ApiPropertyOptional({ description: 'Password if the share link is password-protected' })
  @IsOptional()
  @IsString()
  password?: string;
}
