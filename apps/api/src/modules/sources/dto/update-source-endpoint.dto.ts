import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSourceEndpointDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  endpointUrl?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(50)
  parserType?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(50)
  contentTypeHint?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  scheduleCron?: string;

  @ApiPropertyOptional({ enum: ['active', 'disabled'] })
  @IsString()
  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: string;
}
