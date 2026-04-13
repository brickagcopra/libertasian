import { IsArray, IsUUID } from 'class-validator';

export class BulkApproveDto {
  @IsArray()
  @IsUUID('4', { each: true })
  ids!: string[];
}
