import { ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SimulateLifecycleDto {
  @ApiProperty({
    description: 'Starting subscription state',
    example: 'provisioning',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  startingState!: string;

  @ApiProperty({
    description: 'Ordered list of actions to simulate sequentially (max 50)',
    example: ['START_TRIAL', 'CONVERT_TRIAL', 'REQUEST_CANCEL'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  actions!: string[];
}
