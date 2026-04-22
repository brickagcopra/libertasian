import type { ComponentType } from 'react';

import type { DerivativeDetail, DerivativeType } from '../types';
import { DigestRenderer } from './digest-renderer';
import { DoctrineRenderer } from './doctrine-renderer';
import { EssayRenderer } from './essay-renderer';
import { FlashcardRenderer } from './flashcard-renderer';
import { GenericRenderer } from './generic-renderer';
import { MCQRenderer } from './mcq-renderer';
import { OutlineRenderer } from './outline-renderer';

export { DigestRenderer } from './digest-renderer';
export { DoctrineRenderer } from './doctrine-renderer';
export { EssayRenderer } from './essay-renderer';
export { FlashcardRenderer } from './flashcard-renderer';
export { GenericRenderer } from './generic-renderer';
export { MCQRenderer } from './mcq-renderer';
export { OutlineRenderer } from './outline-renderer';

export const RENDERER_BY_TYPE: Record<
  DerivativeType,
  ComponentType<{ data: DerivativeDetail }>
> = {
  case_digest: DigestRenderer,
  doctrine_extract: DoctrineRenderer,
  mcq_question: MCQRenderer,
  essay_prompt: EssayRenderer,
  subject_outline: OutlineRenderer,
  flashcard: FlashcardRenderer,
  essay_model_answer: GenericRenderer,
  suggested_bar_answer: GenericRenderer,
  sample_pleading: GenericRenderer,
  sample_contract: GenericRenderer,
  one_page_summary: GenericRenderer,
};
