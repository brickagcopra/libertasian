import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignReviewerDto {
  @ApiProperty({ description: 'UUID of the reviewer to assign' })
  @IsUUID()
  reviewerUserId!: string;
}
