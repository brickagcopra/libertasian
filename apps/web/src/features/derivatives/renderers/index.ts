import type { ReactElement } from 'react';

import type { DerivativeDetail, DerivativeType } from '../types';
import { DigestRenderer } from './digest-renderer';
import { DoctrineRenderer } from './doctrine-renderer';
import { EssayModelAnswerRenderer } from './essay-model-answer-renderer';
import { EssayRenderer } from './essay-renderer';
import { FlashcardRenderer } from './flashcard-renderer';
import { GenericRenderer } from './generic-renderer';
import { MCQRenderer } from './mcq-renderer';
import { OnePageSummaryRenderer } from './one-page-summary-renderer';
import { OutlineRenderer } from './outline-renderer';
import { SampleContractRenderer } from './sample-contract-renderer';
import { SamplePleadingRenderer } from './sample-pleading-renderer';
import { SuggestedBarAnswerRenderer } from './suggested-bar-answer-renderer';

export { DigestRenderer } from './digest-renderer';
export { DoctrineRenderer } from './doctrine-renderer';
export { EssayModelAnswerRenderer } from './essay-model-answer-renderer';
export { EssayRenderer } from './essay-renderer';
export { FlashcardRenderer } from './flashcard-renderer';
export { GenericRenderer } from './generic-renderer';
export { MCQRenderer } from './mcq-renderer';
export { OnePageSummaryRenderer } from './one-page-summary-renderer';
export { OutlineRenderer } from './outline-renderer';
export { SampleContractRenderer } from './sample-contract-renderer';
export { SamplePleadingRenderer } from './sample-pleading-renderer';
export { SuggestedBarAnswerRenderer } from './suggested-bar-answer-renderer';

export type DerivativeRenderer = (props: { data: DerivativeDetail }) => ReactElement;

export const RENDERER_BY_TYPE: Record<DerivativeType, DerivativeRenderer> = {
  case_digest: DigestRenderer,
  doctrine_extract: DoctrineRenderer,
  mcq_question: MCQRenderer,
  essay_prompt: EssayRenderer,
  subject_outline: OutlineRenderer,
  flashcard: FlashcardRenderer,
  essay_model_answer: EssayModelAnswerRenderer,
  suggested_bar_answer: SuggestedBarAnswerRenderer,
  sample_pleading: SamplePleadingRenderer,
  sample_contract: SampleContractRenderer,
  one_page_summary: OnePageSummaryRenderer,
};
