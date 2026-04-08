import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateEmailPreferencesDto {
  @ApiPropertyOptional({ description: 'Receive subscription update emails' })
  @IsOptional()
  @IsBoolean()
  subscriptionUpdates?: boolean;

  @ApiPropertyOptional({ description: 'Receive announcement emails' })
  @IsOptional()
  @IsBoolean()
  announcements?: boolean;

  @ApiPropertyOptional({ description: 'Receive blog notification emails' })
  @IsOptional()
  @IsBoolean()
  blogNotifications?: boolean;
}
