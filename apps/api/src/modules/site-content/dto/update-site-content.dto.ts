import { IsObject, IsNotEmptyObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSiteContentDto {
  @ApiProperty({ description: 'Structured JSON content for the page' })
  @IsObject()
  @IsNotEmptyObject()
  content!: Record<string, unknown>;
}
