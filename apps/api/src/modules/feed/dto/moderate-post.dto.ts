import { IsIn } from 'class-validator';

export class ModeratePostDto {
  @IsIn(['hidden', 'removed_by_admin', 'published'])
  status!: string;
}
