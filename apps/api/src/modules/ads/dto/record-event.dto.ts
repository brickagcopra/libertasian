import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class RecordEventDto {
  @IsUUID()
  campaignId!: string;

  @IsOptional()
  @IsUUID()
  creativeId?: string;

  @IsIn(['impression', 'click', 'dismiss', 'cta_click'])
  eventType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  page?: string;
}
