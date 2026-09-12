import {
  DIGEST_REVIEW_STATUS_VALUES,
  DIGEST_TYPE_VALUES,
} from '@libertasian/types';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  DIGEST_TYPE_VALUES as DTO_TYPES,
  REVIEW_STATUS_VALUES as DTO_STATUSES,
  TAXONOMY_VERSION_VALUES,
  ListDigestsQueryDto,
} from './list-digests-query.dto';
import { SearchDigestsQueryDto } from './search-digests-query.dto';

// The API DTO keeps a LOCAL mirror of the filter contract (it cannot import the
// types package at runtime — its dist/ isn't built in Dockerfile.api). These guards
// CI-lock the mirror to the shared source of truth in @libertasian/types so the two
// can never drift apart.
describe('ListDigestsQueryDto filter contract', () => {
  it('digest type filter matches the shared contract', () => {
    expect([...DTO_TYPES].sort()).toEqual([...DIGEST_TYPE_VALUES].sort());
  });

  it('review status filter matches the shared contract', () => {
    expect([...DTO_STATUSES].sort()).toEqual(
      [...DIGEST_REVIEW_STATUS_VALUES].sort(),
    );
  });
});

describe('digest subject filter fields', () => {
  it('exposes exactly the two taxonomies the classifier writes', () => {
    expect([...TAXONOMY_VERSION_VALUES]).toEqual(['study_8', 'bar_admin_6']);
  });

  for (const [name, Dto] of [
    ['ListDigestsQueryDto', ListDigestsQueryDto],
    ['SearchDigestsQueryDto', SearchDigestsQueryDto],
  ] as const) {
    it(`${name} accepts subjectCode + taxonomyVersion`, async () => {
      const dto = plainToInstance(Dto, {
        subjectCode: 'political_law',
        taxonomyVersion: 'bar_admin_6',
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it(`${name} rejects an unknown taxonomyVersion`, async () => {
      const dto = plainToInstance(Dto, { taxonomyVersion: 'study_99' });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('taxonomyVersion');
    });

    it(`${name} rejects a subjectCode over 40 characters`, async () => {
      const dto = plainToInstance(Dto, { subjectCode: 'x'.repeat(41) });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('subjectCode');
    });

    it(`${name} leaves subjectCode optional`, async () => {
      const dto = plainToInstance(Dto, {});
      expect(await validate(dto)).toHaveLength(0);
    });
  }
});
