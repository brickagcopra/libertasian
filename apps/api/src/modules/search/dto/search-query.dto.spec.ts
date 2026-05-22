import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { SearchQueryDto } from './search-query.dto';

describe('SearchQueryDto.documentType', () => {
  it.each([
    // Legacy values — kept for backward compatibility with existing callers.
    'case',
    'statute',
    'codal',
    'article',
    'outline',
  ])('accepts legacy class value %s', (documentType) => {
    const dto = plainToInstance(SearchQueryDto, {
      query: 'negligence',
      documentType,
    });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it.each([
    // The 10 codal-class document_type values added in this PR.
    'constitution',
    'republic_act',
    'commonwealth_act',
    'batas_pambansa',
    'executive_order',
    'presidential_decree',
    'proclamation',
    'administrative_order',
    'rules_of_court',
    'rule',
  ])('accepts codal-class document_type value %s', (documentType) => {
    const dto = plainToInstance(SearchQueryDto, {
      query: 'due process',
      documentType,
    });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects unknown documentType values with isIn constraint', () => {
    const dto = plainToInstance(SearchQueryDto, {
      query: 'anything',
      documentType: 'not_a_real_type',
    });
    const errors = validateSync(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('documentType');
    expect(errors[0]?.constraints).toHaveProperty('isIn');
  });

  it('treats omitted documentType as valid (filter is optional)', () => {
    const dto = plainToInstance(SearchQueryDto, { query: 'negligence' });
    expect(validateSync(dto)).toHaveLength(0);
  });
});
