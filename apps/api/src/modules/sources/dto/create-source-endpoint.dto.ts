import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSourceEndpointDto {
  @ApiProperty({ description: 'URL of the source endpoint' })
  @IsString()
  endpointUrl!: string;

  @ApiProperty({ description: 'Parser type for content extraction' })
  @IsString()
  @MaxLength(50)
  parserType!: string;

  @ApiPropertyOptional({ description: 'Expected content type' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  contentTypeHint?: string;

  @ApiPropertyOptional({ description: 'Cron schedule for automated fetching' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  scheduleCron?: string;

  @ApiPropertyOptional({ enum: ['active', 'disabled'], default: 'active' })
  @IsString()
  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: string;
}
