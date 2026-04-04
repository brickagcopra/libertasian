import { IsIn, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDoctrineLinkDto {
  @ApiProperty({ description: 'Source doctrine ID' })
  @IsUUID()
  fromDoctrineId!: string;

  @ApiProperty({ description: 'Target doctrine ID' })
  @IsUUID()
  toDoctrineId!: string;

  @ApiProperty({
    description: 'Type of relationship between doctrines',
    enum: ['extends', 'overrules', 'distinguishes', 'applies', 'clarifies'],
  })
  @IsIn(['extends', 'overrules', 'distinguishes', 'applies', 'clarifies'])
  linkType!: string;

  @ApiPropertyOptional({ description: 'Confidence score (0-1)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  confidence?: number;
}
