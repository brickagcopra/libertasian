import { NotificationListener } from './notification.listener';
import { NOTIFICATION_EVENTS } from './notification.events';

/**
 * Assignment notifications.
 *
 * The rules that matter, each with a test below:
 *  - a batch of N digests to one person produces ONE notification, not N;
 *  - a notification failure never reaches the assignment (the digest rows are
 *    already written by the time this runs);
 *  - nobody is told about their own action.
 */
describe('NotificationListener — digest assigned', () => {
  function build(
    overrides: {
      actorName?: string | null;
      digestTitle?: string | null;
      createThrows?: boolean;
    } = {},
  ) {
    const created: Array<Record<string, unknown>> = [];
    const notificationCenterService = {
      createNotification: jest.fn().mockImplementation((payload) => {
        if (overrides.createThrows) {
          return Promise.reject(new Error('notification centre is down'));
        }
        created.push(payload as Record<string, unknown>);
        return Promise.resolve(payload);
      }),
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(
          overrides.actorName === null
            ? null
            : { fullName: overrides.actorName ?? 'Ana Editor' },
        ),
      },
      digest: {
        findUnique: jest.fn().mockResolvedValue(
          overrides.digestTitle === null
            ? null
            : { title: overrides.digestTitle ?? 'People v. Dizon' },
        ),
      },
    };

    const listener = new NotificationListener(
      notificationCenterService as never,
      { } as never,
      prisma as never,
    );

    return { listener, created, notificationCenterService, prisma };
  }

  it('is registered on the digest_assigned event', () => {
    expect(NOTIFICATION_EVENTS.DIGEST_ASSIGNED).toBe(
      'notification.digest_assigned',
    );
  });

  it('a batch of 20 digests to one person produces ONE notification', async () => {
    const { listener, created } = build();

    await listener.handleDigestAssigned({
      digestIds: Array.from({ length: 20 }, (_, i) => `digest-${i}`),
      assignedToUserId: 'u-reviewer',
      assignedByUserId: 'u-editor',
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      userId: 'u-reviewer',
      type: 'digest_assigned',
      title: 'Ana Editor assigned you 20 digests to review',
    });
    // entity_id is a UUID column — one row cannot point at twenty digests.
    expect(created[0]).not.toHaveProperty('entityId');
  });

  it('a single assignment names the digest and links to it', async () => {
    const { listener, created } = build();

    await listener.handleDigestAssigned({
      digestIds: ['digest-1'],
      assignedToUserId: 'u-reviewer',
      assignedByUserId: 'u-editor',
    });

    expect(created[0]).toMatchObject({
      title: 'Ana Editor assigned you a digest to review',
      body: 'People v. Dizon',
      entityType: 'digest',
      entityId: 'digest-1',
    });
  });

  it('carries no organizationId — reviewing the shared corpus is platform work', async () => {
    const { listener, created } = build();

    await listener.handleDigestAssigned({
      digestIds: ['digest-1'],
      assignedToUserId: 'u-reviewer',
      assignedByUserId: 'u-editor',
    });

    expect(created[0]).not.toHaveProperty('organizationId');
  });

  it('does not notify someone about their own action', async () => {
    const { listener, notificationCenterService } = build();

    await listener.handleDigestAssigned({
      digestIds: ['digest-1'],
      assignedToUserId: 'u-same',
      assignedByUserId: 'u-same',
    });

    expect(notificationCenterService.createNotification).not.toHaveBeenCalled();
  });

  it('ignores an empty batch', async () => {
    const { listener, notificationCenterService } = build();

    await listener.handleDigestAssigned({
      digestIds: [],
      assignedToUserId: 'u-reviewer',
      assignedByUserId: 'u-editor',
    });

    expect(notificationCenterService.createNotification).not.toHaveBeenCalled();
  });

  it('swallows a notification-centre failure rather than rejecting', async () => {
    // The assignment is already committed. Rejecting here would surface as a
    // failed assign to the operator, or roll one back, for a notification.
    const { listener } = build({ createThrows: true });

    await expect(
      listener.handleDigestAssigned({
        digestIds: ['digest-1'],
        assignedToUserId: 'u-reviewer',
        assignedByUserId: 'u-editor',
      }),
    ).resolves.toBeUndefined();
  });

  it('falls back to a generic actor when the assigner is unknown', async () => {
    const { listener, created } = build({ actorName: null });

    await listener.handleDigestAssigned({
      digestIds: ['digest-1', 'digest-2'],
      assignedToUserId: 'u-reviewer',
      assignedByUserId: null,
    });

    expect(created[0]).toMatchObject({
      title: 'An editor assigned you 2 digests to review',
    });
  });

  it('omits the body when the digest has no title to show', async () => {
    const { listener, created } = build({ digestTitle: null });

    await listener.handleDigestAssigned({
      digestIds: ['digest-1'],
      assignedToUserId: 'u-reviewer',
      assignedByUserId: 'u-editor',
    });

    expect(created[0]).not.toHaveProperty('body');
  });

  it('does not look up a digest title for a batch', async () => {
    const { listener, prisma } = build();

    await listener.handleDigestAssigned({
      digestIds: ['d-1', 'd-2', 'd-3'],
      assignedToUserId: 'u-reviewer',
      assignedByUserId: 'u-editor',
    });

    expect(prisma.digest.findUnique).not.toHaveBeenCalled();
  });
});
