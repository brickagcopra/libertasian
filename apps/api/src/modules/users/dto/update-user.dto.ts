import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Juan Dela Cruz' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fullName?: string;

  @ApiPropertyOptional({ example: '+639171234567' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;
}
