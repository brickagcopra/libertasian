import { IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListRolesQueryDto {
  @ApiPropertyOptional({ description: 'Return only system roles', example: true })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  systemOnly?: boolean;
}
