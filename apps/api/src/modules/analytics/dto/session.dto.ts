import { IsString, IsOptional, IsIn, MaxLength, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StartSessionDto {
  @ApiPropertyOptional({ description: 'Device type', enum: ['web', 'ios', 'android'] })
  @IsIn(['web', 'ios', 'android'])
  @IsOptional()
  deviceType?: string;

  @ApiPropertyOptional({ description: 'Entry path' })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  entryPath?: string;

  @ApiPropertyOptional({ description: 'Referrer URL' })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  referrer?: string;

  @ApiPropertyOptional({ description: 'Additional session properties', type: 'object', additionalProperties: true })
  @IsObject()
  @IsOptional()
  properties?: Record<string, unknown>;
}

export class HeartbeatDto {
  @ApiProperty({ description: 'Session ID' })
  @IsString()
  @MaxLength(100)
  sessionId!: string;

  @ApiPropertyOptional({ description: 'Current page path (updates exit_path)' })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  currentPath?: string;
}

export class EndSessionDto {
  @ApiProperty({ description: 'Session ID' })
  @IsString()
  @MaxLength(100)
  sessionId!: string;
}
