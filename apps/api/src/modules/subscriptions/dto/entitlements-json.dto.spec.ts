import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { SetSubscriptionEntitlementsDto } from './set-subscription-entitlements.dto';
import { PruneEntitlementsJsonDto } from './prune-entitlements-json.dto';

function errorsFor<T extends object>(cls: new () => T, payload: unknown) {
  return validateSync(plainToInstance(cls, payload as object), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('SetSubscriptionEntitlementsDto', () => {
  it('accepts integers and booleans', () => {
    expect(
      errorsFor(SetSubscriptionEntitlementsDto, {
        values: { aiAnswers: 15, previewOnly: false, searchQueries: -1 },
      }),
    ).toHaveLength(0);
  });

  it('rejects an empty map — there is nothing to write', () => {
    expect(
      errorsFor(SetSubscriptionEntitlementsDto, { values: {} }),
    ).not.toHaveLength(0);
  });

  it.each([
    ['a string quota', { aiAnswers: '15' }],
    ['a fractional quota', { aiAnswers: 1.5 }],
    ['a null value', { aiAnswers: null }],
    ['a nested object', { aiAnswers: { limit: 15 } }],
  ])('rejects %s', (_label, values) => {
    // A non-integer, non-boolean value survives the resolver's spread and
    // becomes a limit no comparison handles — a quota that stops being enforced.
    expect(
      errorsFor(SetSubscriptionEntitlementsDto, { values }),
    ).not.toHaveLength(0);
  });

  it('rejects a missing values field', () => {
    expect(errorsFor(SetSubscriptionEntitlementsDto, {})).not.toHaveLength(0);
  });
});

describe('PruneEntitlementsJsonDto', () => {
  it('accepts a key and an integer value', () => {
    expect(
      errorsFor(PruneEntitlementsJsonDto, { key: 'aiAnswers', valueEquals: 0 }),
    ).toHaveLength(0);
  });

  it('accepts a boolean value', () => {
    expect(
      errorsFor(PruneEntitlementsJsonDto, {
        key: 'previewOnly',
        valueEquals: true,
      }),
    ).toHaveLength(0);
  });

  it('requires valueEquals — a prune with no value would clear the key everywhere', () => {
    expect(
      errorsFor(PruneEntitlementsJsonDto, { key: 'aiAnswers' }),
    ).not.toHaveLength(0);
  });

  it('rejects a null valueEquals for the same reason', () => {
    expect(
      errorsFor(PruneEntitlementsJsonDto, {
        key: 'aiAnswers',
        valueEquals: null,
      }),
    ).not.toHaveLength(0);
  });

  it('rejects an empty key', () => {
    expect(
      errorsFor(PruneEntitlementsJsonDto, { key: '', valueEquals: 0 }),
    ).not.toHaveLength(0);
  });
});
