import type { DerivativeDetail, DerivativeType } from '../../types';

/**
 * The 11 content-shape constants now live in `@libertasian/types` so the API's
 * `derivative-extract.ts` can test against the same definitions — `apps/api`
 * cannot import `apps/web/src` (rootDir/TS6059). They are re-exported here so
 * renderer tests keep their original import path.
 */
export {
  MCQ_CONTENT,
  ESSAY_CONTENT,
  DIGEST_CONTENT,
  DOCTRINE_CONTENT,
  OUTLINE_CONTENT,
  FLASHCARD_CONTENT,
  ESSAY_MODEL_ANSWER_CONTENT,
  SUGGESTED_BAR_ANSWER_CONTENT,
  SAMPLE_PLEADING_CONTENT,
  SAMPLE_CONTRACT_CONTENT,
  ONE_PAGE_SUMMARY_CONTENT,
} from '@libertasian/types';

export function makeDetail(
  type: DerivativeType,
  contentJson: unknown,
  overrides: Partial<DerivativeDetail> = {},
): DerivativeDetail {
  return {
    id: 'test-id',
    title: 'Test Artifact',
    derivativeType: type,
    confidenceScore: 0.85,
    createdAt: '2026-04-20T10:00:00Z',
    publishedAt: null,
    audience: 'both',
    language: 'en',
    sourceDocument: null,
    subjects: [
      {
        code: 'criminal_law',
        name: 'Criminal Law',
        taxonomyVersion: 'study_8',
        isPrimary: true,
      },
    ],
    disclaimer: { id: 'cd-1', contentClass: String(type), version: 1 },
    isGated: false,
    upgradeTier: null,
    contentJson,
    contentPlainText: null,
    disclaimerBody: { bodyHtml: '<p>disc</p>', bodyPlain: 'disclaimer' },
    mcqQuestion: null,
    essayPrompt: null,
    ...overrides,
  };
}
