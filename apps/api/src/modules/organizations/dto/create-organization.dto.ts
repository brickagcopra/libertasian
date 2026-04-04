import { IsNotEmpty, IsOptional, IsString, MaxLength, Matches, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrganizationDto {
  @ApiProperty({ description: 'Organization name', example: 'Reyes & Associates Law' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ description: 'Organization type', enum: ['individual', 'firm', 'school', 'editorial'] })
  @IsOptional()
  @IsString()
  @IsIn(['individual', 'firm', 'school', 'editorial'])
  type?: string;
}
