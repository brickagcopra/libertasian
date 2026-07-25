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

  // The court filter matched zero of 7,443 Supreme Court documents because the
  // dropdown sent `supreme_court` while the index held the display literal.
  // Normalising here is half the fix; `court_key` in the index is the other.
  describe('court', () => {
    it.each([
      ['supreme_court', 'supreme_court'],
      ['Supreme Court', 'supreme_court'],
      ['Regional Trial Court', 'regional_trial_court'],
      ['court_of_tax_appeals', 'court_of_tax_appeals'],
    ])('normalises %j to %j', (input, expected) => {
      const dto = plainToInstance(SearchQueryDto, { query: 'estafa', court: input });
      expect(validateSync(dto)).toHaveLength(0);
      expect(dto.court).toBe(expected);
    });

    it('accepts Regional Trial Court, which the old dropdown omitted entirely', () => {
      const dto = plainToInstance(SearchQueryDto, {
        query: 'estafa',
        court: 'regional_trial_court',
      });
      expect(validateSync(dto)).toHaveLength(0);
    });

    it('rejects an unknown court instead of silently returning nothing', () => {
      const dto = plainToInstance(SearchQueryDto, {
        query: 'estafa',
        court: 'municipal_circuit_trial_court',
      });
      const errors = validateSync(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('court');
      expect(errors[0]?.constraints).toHaveProperty('isIn');
    });

    it('treats an empty court as omitted', () => {
      const dto = plainToInstance(SearchQueryDto, { query: 'estafa', court: '' });
      expect(validateSync(dto)).toHaveLength(0);
      expect(dto.court).toBeUndefined();
    });
  });
});
