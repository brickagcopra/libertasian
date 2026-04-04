import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateMemberRoleDto {
  @ApiProperty({
    description: 'New role for the member',
    enum: ['admin', 'editor', 'member', 'reviewer', 'student'],
  })
  @IsString()
  @IsIn(['admin', 'editor', 'member', 'reviewer', 'student'])
  role!: string;
}
