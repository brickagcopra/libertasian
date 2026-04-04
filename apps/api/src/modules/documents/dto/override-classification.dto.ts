import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class OverrideClassificationDto {
  @IsUUID()
  documentId!: string;

  @IsUUID()
  primaryTagId!: string;

  @IsArray()
  @IsUUID(undefined, { each: true })
  @ArrayMinSize(0)
  secondaryTagIds!: string[];
}
