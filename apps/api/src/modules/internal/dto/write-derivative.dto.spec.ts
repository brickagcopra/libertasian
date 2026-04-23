import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { WriteDerivativeDto } from './write-derivative.dto';

// class-validator @IsUUID() defaults to v4, so fixtures use v4 uuids.
const V4_DOC = 'f47ac10b-58cc-4372-a567-0e02b2c3d501';
const V4_SECTION = 'f47ac10b-58cc-4372-a567-0e02b2c3d502';
const V4_JOB = 'f47ac10b-58cc-4372-a567-0e02b2c3d503';
const V4_MODEL_RUN = 'f47ac10b-58cc-4372-a567-0e02b2c3d504';
const V4_DISCLAIMER = 'f47ac10b-58cc-4372-a567-0e02b2c3d505';

// Representative shapes captured from worker bulk-gen runs on 2026-04-23.
// The shapes below match what services/worker-service/src/tasks/{flashcard,
// outline}_generation_tasks.py actually POST to /internal/derivatives/write.
function flashcardPayload(overrides: Record<string, unknown> = {}) {
  return {
    derivativeType: 'flashcard',
    sourceDocumentId: V4_DOC,
    derivativeGenerationJobId: V4_JOB,
    title: 'Flashcards: Sample Case',
    contentJson: {
      cards: [
        { front: 'Q1', back: 'A1', supportingSectionIds: [V4_SECTION] },
      ],
      style: 'rule_recall',
      cardCount: 1,
      generatedAt: '2026-04-23T00:00:00Z',
    },
    contentHash: 'sha256-abc123',
    contentRights: 'ai_generated_derivative',
    contentDisclaimerId: V4_DISCLAIMER,
    visibility: 'private',
    reviewStatus: 'draft',
    validatorVerdict: 'auto_approve',
    validatorReasonsJson: { checks: [] },
    confidenceScore: 0.82,
    modelRunId: V4_MODEL_RUN,
    provenanceRecords: [
      {
        sourceDocumentId: V4_DOC,
        sourceSectionId: V4_SECTION,
        provenanceType: 'source_passage',
      },
    ],
    ...overrides,
  };
}

function outlinePayload(overrides: Record<string, unknown> = {}) {
  return {
    derivativeType: 'subject_outline',
    sourceDocumentId: V4_DOC,
    derivativeGenerationJobId: V4_JOB,
    title: 'Subject Outline: Civil Law',
    contentJson: {
      sections: [
        { heading: 'I. Introduction', citedSectionIds: [V4_SECTION] },
      ],
    },
    contentHash: 'sha256-def456',
    contentRights: 'ai_generated_derivative',
    contentDisclaimerId: V4_DISCLAIMER,
    reviewStatus: 'draft',
    validatorVerdict: 'auto_approve',
    validatorReasonsJson: { checks: [] },
    confidenceScore: 0.78,
    modelRunId: V4_MODEL_RUN,
    provenanceRecords: [
      {
        sourceDocumentId: V4_DOC,
        sourceSectionId: V4_SECTION,
        provenanceType: 'source_passage',
      },
    ],
    budgetLedgerEntry: {
      periodYearMonth: '2026-04',
      scope: 'subject_outline_generation',
      amountUsd: 0.0,
      tokensIn: 1000,
      tokensOut: 500,
      modelName: 'test-model',
      modelRunId: V4_MODEL_RUN,
    },
    ...overrides,
  };
}

describe('WriteDerivativeDto validation', () => {
  it('accepts a well-formed flashcard payload', () => {
    const dto = plainToInstance(WriteDerivativeDto, flashcardPayload());
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts a well-formed outline payload', () => {
    const dto = plainToInstance(WriteDerivativeDto, outlinePayload());
    expect(validateSync(dto)).toHaveLength(0);
  });

  // Regression: worker bulk-gen on 2026-04-23 was POSTing
  // { ..., "contentHash": "", ... } for both flashcard and outline. The DTO
  // marks contentHash @IsString() @IsNotEmpty(), so every call returned 400
  // within 1–27ms (pipe-level rejection before reaching the service).
  it('rejects empty contentHash on flashcard payload (reproduces prod 400)', () => {
    const dto = plainToInstance(
      WriteDerivativeDto,
      flashcardPayload({ contentHash: '' }),
    );
    const errors = validateSync(dto);

    const flat = JSON.stringify(errors);
    expect(flat).toContain('contentHash');
    expect(flat).toContain('isNotEmpty');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects empty contentHash on outline payload (reproduces prod 400)', () => {
    const dto = plainToInstance(
      WriteDerivativeDto,
      outlinePayload({ contentHash: '' }),
    );
    const errors = validateSync(dto);

    const flat = JSON.stringify(errors);
    expect(flat).toContain('contentHash');
    expect(flat).toContain('isNotEmpty');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects missing contentDisclaimerId', () => {
    const payload: Record<string, unknown> = flashcardPayload();
    delete payload['contentDisclaimerId'];

    const dto = plainToInstance(WriteDerivativeDto, payload);
    const errors = validateSync(dto);

    const flat = JSON.stringify(errors);
    expect(flat).toContain('contentDisclaimerId');
    expect(errors.length).toBeGreaterThan(0);
  });
});
