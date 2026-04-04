import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RevokeEntitlementOverrideDto {
  @ApiProperty({ description: 'Reason for revoking the override' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
