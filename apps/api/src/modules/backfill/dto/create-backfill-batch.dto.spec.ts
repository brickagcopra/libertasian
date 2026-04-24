import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  BACKFILL_SLUG_TO_PARSER_TYPE,
  CreateBackfillBatchDto,
} from './create-backfill-batch.dto';

/**
 * Pure class-validator tests for CreateBackfillBatchDto. These exercise the
 * XOR constraint between sourceId and sourceSlug plus the allowed slug
 * values — things that are hard to confirm through the role-guarded e2e
 * path without setting up an admin user.
 */
describe('CreateBackfillBatchDto validation', () => {
  const baseValid = {
    name: 'Test Batch',
    yearStart: 2020,
    yearEnd: 2020,
    budgetCeilingUsd: 5,
  };

  it('accepts sourceId alone', async () => {
    const dto = plainToInstance(CreateBackfillBatchDto, {
      ...baseValid,
      sourceId: '00000000-0000-4000-a000-000000000001',
    });
    const errors = await validate(dto);
    expect(errors).toEqual([]);
  });

  it('accepts sourceSlug alone with lawphil', async () => {
    const dto = plainToInstance(CreateBackfillBatchDto, {
      ...baseValid,
      sourceSlug: 'lawphil',
    });
    const errors = await validate(dto);
    expect(errors).toEqual([]);
  });

  it('accepts sourceSlug alone with scel', async () => {
    const dto = plainToInstance(CreateBackfillBatchDto, {
      ...baseValid,
      sourceSlug: 'scel',
    });
    const errors = await validate(dto);
    expect(errors).toEqual([]);
  });

  it('rejects an unknown sourceSlug', async () => {
    const dto = plainToInstance(CreateBackfillBatchDto, {
      ...baseValid,
      sourceSlug: 'officialgazette',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'sourceSlug')).toBe(true);
  });

  it('rejects when neither sourceId nor sourceSlug is provided', async () => {
    const dto = plainToInstance(CreateBackfillBatchDto, baseValid);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'sourceId')).toBe(true);
  });

  it('rejects a non-UUID sourceId when sourceSlug absent', async () => {
    const dto = plainToInstance(CreateBackfillBatchDto, {
      ...baseValid,
      sourceId: 'not-a-uuid',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'sourceId')).toBe(true);
  });

  it('rejects yearStart below the 1901 floor', async () => {
    const dto = plainToInstance(CreateBackfillBatchDto, {
      ...baseValid,
      sourceSlug: 'lawphil',
      yearStart: 1850,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'yearStart')).toBe(true);
  });

  it('exports the slug → parser_type map with lawphil and scel', () => {
    expect(BACKFILL_SLUG_TO_PARSER_TYPE).toEqual({
      lawphil: 'lawphil',
      scel: 'supreme_court_elibrary',
    });
  });
});
