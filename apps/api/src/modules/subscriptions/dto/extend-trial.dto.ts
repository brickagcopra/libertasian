import { IsInt, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ExtendTrialDto {
  @ApiProperty({
    description: 'Number of days to extend the trial by',
    minimum: 1,
    maximum: 90,
    example: 14,
  })
  @IsInt()
  @Min(1)
  @Max(90)
  extensionDays!: number;
}
