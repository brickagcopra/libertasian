import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { DERIVATIVE_TYPES } from './list-derivatives.query.dto';

export class FindOneDerivativeQueryDto {
  @ApiPropertyOptional({
    description:
      'Project a bridged artifact AS this derivative type (e.g. essay_model_answer surfaces the model answer embedded in an essay_prompt).',
    enum: DERIVATIVE_TYPES,
  })
  @IsIn([...DERIVATIVE_TYPES])
  @IsOptional()
  as?: string;
}
