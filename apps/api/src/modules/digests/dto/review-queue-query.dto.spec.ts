import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ReviewQueueQueryDto } from './review-queue-query.dto';

describe('ReviewQueueQueryDto assignedTo validation', () => {
  async function validateAssignedTo(assignedTo?: string) {
    const dto = plainToInstance(ReviewQueueQueryDto, { assignedTo });
    const errors = await validate(dto);
    return errors.find((e) => e.property === 'assignedTo');
  }

  it('accepts the "unassigned" sentinel', async () => {
    const error = await validateAssignedTo('unassigned');
    expect(error).toBeUndefined();
  });

  it('accepts a valid reviewer UUID', async () => {
    const error = await validateAssignedTo('3f2b1a9c-8d7e-4f6a-b5c4-d3e2f1a0b9c8');
    expect(error).toBeUndefined();
  });

  it('accepts omitting the filter entirely', async () => {
    const error = await validateAssignedTo(undefined);
    expect(error).toBeUndefined();
  });

  // Regression: the web UI once sent '__unassigned__', which fell through to
  // Prisma as assignedReviewerUserId and crashed with a UUID parse error (500).
  // Invalid values must now fail DTO validation with a 400.
  it('rejects the legacy "__unassigned__" sentinel', async () => {
    const error = await validateAssignedTo('__unassigned__');
    expect(error).toBeDefined();
  });

  it('rejects an arbitrary non-UUID string', async () => {
    const error = await validateAssignedTo('not-a-uuid');
    expect(error).toBeDefined();
  });
});
