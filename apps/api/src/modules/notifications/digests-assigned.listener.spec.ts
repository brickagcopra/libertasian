import type { PrismaService } from '../../prisma/prisma.service';
import type { NotificationCenterService } from './notification-center.service';
import type { NotificationsService } from './notifications.service';
import { NotificationListener } from './notification.listener';
import type { DigestsAssignedEvent } from './notification.events';

/**
 * Digest assignment notifications.
 *
 * Deliberately a DIGESTS_ASSIGNED event rather than a reuse of TASK_ASSIGNED:
 * the task payload carries `entityType: 'task'`, which would point the
 * notification's deep link at a task id that does not exist, and it is shaped
 * for one entity, which cannot express "N digests, one notification".
 */
describe('NotificationListener — digests assigned', () => {
  function build() {
    const center = { createNotification: jest.fn().mockResolvedValue({}) };
    const listener = new NotificationListener(
      center as unknown as NotificationCenterService,
      {} as unknown as NotificationsService,
      {} as unknown as PrismaService,
    );
    return { listener, center };
  }

  function event(overrides: Partial<DigestsAssignedEvent> = {}): DigestsAssignedEvent {
    return {
      digestIds: ['d-1'],
      sampleTitle: 'People v. Cruz',
      assignedToUserId: 'u-reviewer',
      assignedByUserId: 'u-admin',
      assignedByName: 'Ada Admin',
      organizationId: 'org-1',
      ...overrides,
    };
  }

  it('creates exactly ONE notification for a batch of many digests', async () => {
    const { listener, center } = build();
    const digestIds = Array.from({ length: 200 }, (_, i) => `d-${i}`);

    await listener.handleDigestsAssigned(event({ digestIds }));

    expect(center.createNotification).toHaveBeenCalledTimes(1);
  });

  it('says how many, and points the batch at the queue rather than one digest', async () => {
    const { listener, center } = build();

    await listener.handleDigestsAssigned(
      event({ digestIds: ['d-1', 'd-2', 'd-3'] }),
    );

    expect(center.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-reviewer',
        type: 'digests_assigned',
        title: 'Ada Admin assigned you 3 digests to review',
        entityType: 'digest',
        entityId: 'review-queue',
      }),
    );
  });

  it('deep-links to the digest when exactly one was assigned', async () => {
    const { listener, center } = build();

    await listener.handleDigestsAssigned(event({ digestIds: ['d-42'] }));

    expect(center.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Ada Admin assigned you a digest to review',
        body: 'People v. Cruz',
        entityId: 'd-42',
      }),
    );
  });

  it('says nothing when someone assigns work to themselves', async () => {
    const { listener, center } = build();

    await listener.handleDigestsAssigned(
      event({ assignedToUserId: 'u-admin', assignedByUserId: 'u-admin' }),
    );

    expect(center.createNotification).not.toHaveBeenCalled();
  });

  it('ignores an empty batch', async () => {
    const { listener, center } = build();

    await listener.handleDigestsAssigned(event({ digestIds: [] }));

    expect(center.createNotification).not.toHaveBeenCalled();
  });

  it('survives an untitled digest', async () => {
    const { listener, center } = build();

    await listener.handleDigestsAssigned(event({ sampleTitle: null }));

    expect(center.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Open the review queue to start.' }),
    );
  });

  it('swallows a notification failure rather than surfacing it', async () => {
    // The assignment is already written by the time this runs. A failure here
    // must never become a failed assignment.
    const { listener, center } = build();
    center.createNotification.mockRejectedValue(new Error('db down'));

    await expect(listener.handleDigestsAssigned(event())).resolves.toBeUndefined();
  });
});
