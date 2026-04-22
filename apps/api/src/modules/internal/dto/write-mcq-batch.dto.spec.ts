import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { WriteMcqBatchDto } from './write-mcq-batch.dto';

// class-validator @IsUUID() without args defaults to v4, so fixtures use v4.
const V4_DOC = 'f47ac10b-58cc-4372-a567-0e02b2c3d401';
const V4_DISC = 'f47ac10b-58cc-4372-a567-0e02b2c3d402';
const V4_SECTION = 'f47ac10b-58cc-4372-a567-0e02b2c3d403';

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    sourceDocumentId: V4_DOC,
    contentJson: { questions: [] },
    contentRights: 'ai_generated_derivative',
    contentDisclaimerId: V4_DISC,
    questions: [
      {
        questionStem: 'Q1?',
        difficulty: 'medium',
        questionFormat: 'single_best',
        options: [
          { label: 'A', text: 'Opt A', isCorrect: true },
          { label: 'B', text: 'Opt B', isCorrect: false },
          { label: 'C', text: 'Opt C', isCorrect: false },
          { label: 'D', text: 'Opt D', isCorrect: false },
        ],
        supportingSectionIds: [V4_SECTION],
      },
    ],
    ...overrides,
  };
}

describe('WriteMcqBatchDto validation', () => {
  it('accepts questions whose supportingSectionIds are all UUIDs', () => {
    const dto = plainToInstance(WriteMcqBatchDto, makePayload());
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects supportingSectionIds containing a non-UUID string (400 at pipe)', () => {
    const payload = makePayload({
      questions: [
        {
          questionStem: 'Q1?',
          difficulty: 'medium',
          questionFormat: 'single_best',
          options: [
            { label: 'A', text: 'Opt A', isCorrect: true },
            { label: 'B', text: 'Opt B', isCorrect: false },
            { label: 'C', text: 'Opt C', isCorrect: false },
            { label: 'D', text: 'Opt D', isCorrect: false },
          ],
          supportingSectionIds: [V4_SECTION, 'not-a-uuid'],
        },
      ],
    });

    const dto = plainToInstance(WriteMcqBatchDto, payload);
    const errors = validateSync(dto);

    // class-validator surfaces nested-array failures via the top-level
    // `questions` error node. Walk it to find the isUuid constraint.
    const flat = JSON.stringify(errors);
    expect(flat).toContain('isUuid');
    expect(errors.length).toBeGreaterThan(0);
  });
});
