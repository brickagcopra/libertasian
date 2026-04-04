import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StartTrialDto {
  @ApiProperty({
    description: 'Plan code to trial',
    example: 'pro',
    enum: ['edu', 'pro', 'team', 'enterprise'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['edu', 'pro', 'team', 'enterprise'])
  planCode!: string;
}
