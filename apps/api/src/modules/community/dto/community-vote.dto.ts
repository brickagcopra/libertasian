import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpsertCommunityVoteDto {
  @ApiProperty({ description: 'Vote type', enum: ['up', 'down'] })
  @IsIn(['up', 'down'])
  voteType!: string;
}
