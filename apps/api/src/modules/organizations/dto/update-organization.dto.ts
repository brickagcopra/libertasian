import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateOrganizationDto {
  @ApiPropertyOptional({ description: 'Organization name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}
