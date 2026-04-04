import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignCouponUsersDto {
  @ApiProperty({ description: 'Array of user IDs to assign the coupon to', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export class AssignCouponOrgsDto {
  @ApiProperty({ description: 'Array of organization IDs to assign the coupon to', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  organizationIds!: string[];
}
