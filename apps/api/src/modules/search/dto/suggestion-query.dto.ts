import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class SuggestionQueryDto {
  @ApiProperty({ description: 'Prefix text for autocomplete' })
  @IsString()
  @MaxLength(200)
  q!: string;

  @ApiPropertyOptional({ description: 'Max number of suggestions', default: 10 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  limit?: number;
}
