import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { WriteFlashcardsDto } from './write-flashcards.dto';

// class-validator @IsUUID() defaults to v4, so fixtures use v4 uuids.
const V4_ORG = 'f47ac10b-58cc-4372-a567-0e02b2c3d401';
const V4_USER = 'f47ac10b-58cc-4372-a567-0e02b2c3d402';
const V4_DOC = 'f47ac10b-58cc-4372-a567-0e02b2c3d403';

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Flashcards: Sample Case',
    visibility: 'private',
    organizationId: V4_ORG,
    userId: V4_USER,
    sourceDocumentId: V4_DOC,
    cards: [
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
    ],
    ...overrides,
  };
}

describe('WriteFlashcardsDto validation', () => {
  it('accepts a payload with valid UUID organizationId + userId', () => {
    const dto = plainToInstance(WriteFlashcardsDto, makePayload());
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects empty-string userId at the pipe (defense in depth for worker bulk-gen)', () => {
    // Regression: the worker used to forward undefined/empty user_id to this
    // endpoint; the service then defaulted to '' and hit a Prisma NOT NULL
    // on FlashcardSet.user_id. Reject at the pipe so the failure mode is a
    // 400 at the boundary, not a 500 from Prisma.
    const dto = plainToInstance(WriteFlashcardsDto, makePayload({ userId: '' }));
    const errors = validateSync(dto);

    const flat = JSON.stringify(errors);
    expect(flat).toContain('isUuid');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects empty-string organizationId at the pipe', () => {
    const dto = plainToInstance(
      WriteFlashcardsDto,
      makePayload({ organizationId: '' }),
    );
    const errors = validateSync(dto);

    const flat = JSON.stringify(errors);
    expect(flat).toContain('isUuid');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects missing userId (undefined)', () => {
    const payload: Record<string, unknown> = makePayload();
    delete payload['userId'];

    const dto = plainToInstance(WriteFlashcardsDto, payload);
    const errors = validateSync(dto);

    const flat = JSON.stringify(errors);
    expect(flat).toContain('isUuid');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects missing organizationId (undefined)', () => {
    const payload: Record<string, unknown> = makePayload();
    delete payload['organizationId'];

    const dto = plainToInstance(WriteFlashcardsDto, payload);
    const errors = validateSync(dto);

    const flat = JSON.stringify(errors);
    expect(flat).toContain('isUuid');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-UUID userId', () => {
    const dto = plainToInstance(
      WriteFlashcardsDto,
      makePayload({ userId: 'not-a-uuid' }),
    );
    const errors = validateSync(dto);

    const flat = JSON.stringify(errors);
    expect(flat).toContain('isUuid');
    expect(errors.length).toBeGreaterThan(0);
  });
});
