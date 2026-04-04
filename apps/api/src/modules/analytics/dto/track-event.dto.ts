import {
  IsString,
  IsOptional,
  IsObject,
  IsInt,
  IsIn,
  MaxLength,
  IsUUID,
  ValidateNested,
  IsArray,
  ArrayMaxSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

import { VALID_EVENT_NAMES, type EventName } from '../constants/event-taxonomy';

export class TrackEventDto {
  @ApiProperty({ description: 'Event name from taxonomy whitelist', example: 'search_executed' })
  @IsString()
  @MaxLength(100)
  @IsIn(VALID_EVENT_NAMES as unknown as string[])
  eventName!: string;

  @ApiPropertyOptional({ description: 'Session identifier' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  sessionId?: string;

  @ApiPropertyOptional({ description: 'Device type', enum: ['web', 'ios', 'android'] })
  @IsIn(['web', 'ios', 'android'])
  @IsOptional()
  deviceType?: string;

  @ApiProperty({ description: 'Event-specific properties (validated against taxonomy)', type: 'object' })
  @IsObject()
  properties!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Duration in milliseconds (for timed events)' })
  @IsInt()
  @IsOptional()
  durationMs?: number;
}

export class TrackBatchDto {
  @ApiProperty({ description: 'Array of events (max 100)', type: [TrackEventDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TrackEventDto)
  events!: TrackEventDto[];
}
