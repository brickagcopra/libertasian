import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  SubjectsSummaryByTypeParamDto,
  SubjectsSummaryByTypeQueryDto,
} from './subjects-summary-by-type.query.dto';

describe('SubjectsSummaryByTypeParamDto', () => {
  it.each([
    'case_digest',
    'doctrine_extract',
    'mcq_question',
    'essay_prompt',
    'essay_model_answer',
    'suggested_bar_answer',
    'flashcard',
    'subject_outline',
    'sample_pleading',
    'sample_contract',
    'one_page_summary',
  ])('accepts %s', (type) => {
    const dto = plainToInstance(SubjectsSummaryByTypeParamDto, { type });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects unknown derivative types (invalid → 400 at pipe)', () => {
    const dto = plainToInstance(SubjectsSummaryByTypeParamDto, {
      type: 'not_a_real_type',
    });
    const errors = validateSync(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('isIn');
  });
});

describe('SubjectsSummaryByTypeQueryDto', () => {
  it('accepts study_8 and bar_admin_6', () => {
    for (const v of ['study_8', 'bar_admin_6']) {
      const dto = plainToInstance(SubjectsSummaryByTypeQueryDto, {
        taxonomyVersion: v,
      });
      expect(validateSync(dto)).toHaveLength(0);
    }
  });

  it('treats omitted taxonomyVersion as valid (defaults at service layer)', () => {
    const dto = plainToInstance(SubjectsSummaryByTypeQueryDto, {});
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects unknown taxonomy versions', () => {
    const dto = plainToInstance(SubjectsSummaryByTypeQueryDto, {
      taxonomyVersion: 'made_up',
    });
    const errors = validateSync(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
