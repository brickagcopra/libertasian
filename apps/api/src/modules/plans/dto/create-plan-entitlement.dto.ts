import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlanEntitlementDto {
  @ApiProperty({
    description: 'Entitlement key (e.g., aiAnswers, searchQueries)',
    example: 'aiAnswers',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  key!: string;

  @ApiProperty({
    description: 'Value type',
    enum: ['numeric', 'boolean', 'unlimited'],
    example: 'numeric',
  })
  @IsString()
  @IsEnum(['numeric', 'boolean', 'unlimited'])
  valueType!: string;

  @ApiPropertyOptional({ description: 'Numeric value (for numeric type)', example: 200 })
  @IsInt()
  @IsOptional()
  numericValue?: number;

  @ApiPropertyOptional({ description: 'Boolean value (for boolean type)', example: true })
  @IsBoolean()
  @IsOptional()
  booleanValue?: boolean;

  @ApiPropertyOptional({ description: 'Description of the entitlement' })
  @IsString()
  @IsOptional()
  description?: string;
}
