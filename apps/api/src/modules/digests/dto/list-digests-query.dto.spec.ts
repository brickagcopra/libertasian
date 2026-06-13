import {
  DIGEST_REVIEW_STATUS_VALUES,
  DIGEST_TYPE_VALUES,
} from '@libertasian/types';

import {
  DIGEST_TYPE_VALUES as DTO_TYPES,
  REVIEW_STATUS_VALUES as DTO_STATUSES,
} from './list-digests-query.dto';

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
