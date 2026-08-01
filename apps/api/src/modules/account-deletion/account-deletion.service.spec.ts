import { getQueueToken } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { XenditService } from '../billing/xendit.service';
import { AccountDeletionService } from './account-deletion.service';
import {
  ACCOUNT_PURGE_QUEUE,
  DELETION_RESTORE_WINDOW_DAYS,
} from './account-deletion.types';
import { DeleteAccountDto } from './dto/delete-account.dto';

// bcrypt is a native module — its exports are non-configurable, so jest.spyOn
// cannot redefine them. Mock the module instead, matching auth.service.spec.
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const DAY_MS = 24 * 60 * 60 * 1000;

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;

  const passwordUser = {
    id: 'user-1',
    email: 'juan@example.com',
    passwordHash: '$2b$12$hash',
    status: 'active',
    deletionRequestedAt: null as Date | null,
  };

  const socialUser = {
    id: 'user-2',
    email: 'maria@example.com',
    passwordHash: null,
    status: 'active',
    deletionRequestedAt: null as Date | null,
  };

  const prisma = {
    user: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    organization: { updateMany: jest.fn() },
    organizationMember: { findMany: jest.fn() },
    subscription: { findMany: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  };

  const audit = { log: jest.fn() };
  const auth = { revokeAllSessions: jest.fn() };
  const xendit = { cancelSubscription: jest.fn() };
  const queue = { add: jest.fn() };

  const dtoWithPassword = (password = 'correct-horse'): DeleteAccountDto =>
    ({ confirm: 'DELETE', password }) as DeleteAccountDto;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountDeletionService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: AuthService, useValue: auth },
        { provide: XenditService, useValue: xendit },
        { provide: getQueueToken(ACCOUNT_PURGE_QUEUE), useValue: queue },
      ],
    }).compile();

    service = module.get(AccountDeletionService);

    jest.clearAllMocks();

    // Default happy-path wiring: solo org, no subscription.
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    );
    prisma.organizationMember.findMany.mockResolvedValue([]);
    prisma.subscription.findMany.mockResolvedValue([]);
    prisma.user.update.mockResolvedValue(undefined);
    prisma.organization.updateMany.mockResolvedValue({ count: 0 });
  });

  // ---- Ownership proof ----

  describe('ownership verification', () => {
    it('rejects a password account that supplies no password', async () => {
      prisma.user.findUnique.mockResolvedValue(passwordUser);

      await expect(
        service.requestDeletion(
          'user-1',
          { confirm: 'DELETE' } as DeleteAccountDto,
          {},
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a wrong password with 401', async () => {
      prisma.user.findUnique.mockResolvedValue(passwordUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.requestDeletion('user-1', dtoWithPassword('wrong'), {}),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('requires social-only accounts to echo the exact account email', async () => {
      prisma.user.findUnique.mockResolvedValue(socialUser);

      await expect(
        service.requestDeletion(
          'user-2',
          { confirm: 'DELETE', email: 'MARIA@wrong.com' } as DeleteAccountDto,
          {},
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('accepts a social-only account echoing the email case-insensitively', async () => {
      prisma.user.findUnique.mockResolvedValue(socialUser);

      await expect(
        service.requestDeletion(
          'user-2',
          { confirm: 'DELETE', email: ' Maria@Example.com ' } as DeleteAccountDto,
          {},
        ),
      ).resolves.toMatchObject({ status: 'pending_deletion' });
    });
  });

  // ---- Org guard rail ----

  describe('organization guard rail', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(passwordUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    });

    it('refuses with 409 naming the members when sole owner of a shared org', async () => {
      prisma.organizationMember.findMany.mockResolvedValue([
        {
          organizationId: 'org-1',
          organization: {
            name: 'Dela Cruz Law',
            members: [
              {
                role: 'member',
                user: { fullName: 'Ana Reyes', email: 'ana@example.com' },
              },
            ],
          },
        },
      ]);

      await expect(
        service.requestDeletion('user-1', dtoWithPassword(), {}),
      ).rejects.toThrow(ConflictException);

      await expect(
        service.requestDeletion('user-1', dtoWithPassword(), {}),
      ).rejects.toThrow(/Ana Reyes/);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('redacts member emails in the 409 message', async () => {
      prisma.organizationMember.findMany.mockResolvedValue([
        {
          organizationId: 'org-1',
          organization: {
            name: 'Dela Cruz Law',
            members: [
              {
                role: 'member',
                user: { fullName: 'Ana Reyes', email: 'ana@example.com' },
              },
            ],
          },
        },
      ]);

      await expect(
        service.requestDeletion('user-1', dtoWithPassword(), {}),
      ).rejects.toThrow(/a\*\*\*@example\.com/);
    });

    it('allows deletion when another active owner can take over', async () => {
      prisma.organizationMember.findMany.mockResolvedValue([
        {
          organizationId: 'org-1',
          organization: {
            name: 'Dela Cruz Law',
            members: [
              {
                role: 'owner',
                user: { fullName: 'Ana Reyes', email: 'ana@example.com' },
              },
            ],
          },
        },
      ]);

      await expect(
        service.requestDeletion('user-1', dtoWithPassword(), {}),
      ).resolves.toMatchObject({ status: 'pending_deletion' });

      // The org survives — it is not marked for deletion.
      expect(prisma.organization.updateMany).not.toHaveBeenCalled();
    });

    it('marks a solo org for deletion alongside the account', async () => {
      prisma.organizationMember.findMany.mockResolvedValue([
        {
          organizationId: 'org-solo',
          organization: { name: 'Solo Practice', members: [] },
        },
      ]);

      await service.requestDeletion('user-1', dtoWithPassword(), {});

      expect(prisma.organization.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['org-solo'] } }),
        }),
      );
    });
  });

  // ---- Request effects ----

  describe('requestDeletion', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(passwordUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    });

    it('deactivates the account and revokes every session', async () => {
      const result = await service.requestDeletion(
        'user-1',
        dtoWithPassword(),
        {},
      );

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ status: 'pending_deletion' }),
        }),
      );
      expect(auth.revokeAllSessions).toHaveBeenCalledWith('user-1');
      expect(result.restoreWindowDays).toBe(DELETION_RESTORE_WINDOW_DAYS);
      expect(result.scheduledPurgeAt.getTime()).toBe(
        result.deletionRequestedAt.getTime() +
          DELETION_RESTORE_WINDOW_DAYS * DAY_MS,
      );
    });

    it('audit-logs the request with the email redacted', async () => {
      await service.requestDeletion('user-1', dtoWithPassword(), {
        ip: '1.2.3.4',
      });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.account_deletion_requested',
          metadata: expect.objectContaining({ email: 'j***@example.com' }),
        }),
      );
    });

    it('is idempotent — a second request returns the existing schedule', async () => {
      const requestedAt = new Date('2026-07-01T00:00:00.000Z');
      prisma.user.findUnique.mockResolvedValue({
        ...passwordUser,
        status: 'pending_deletion',
        deletionRequestedAt: requestedAt,
      });

      const result = await service.requestDeletion(
        'user-1',
        dtoWithPassword(),
        {},
      );

      expect(result.deletionRequestedAt).toEqual(requestedAt);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('404s for an already-deleted account', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...passwordUser,
        status: 'deleted',
      });

      await expect(
        service.requestDeletion('user-1', dtoWithPassword(), {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- Subscription cancellation ----

  describe('subscription cancellation', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(passwordUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.organizationMember.findMany.mockResolvedValue([
        {
          organizationId: 'org-solo',
          organization: { name: 'Solo Practice', members: [] },
        },
      ]);
    });

    it('cancels a comp plan locally WITHOUT calling Xendit when the id is null', async () => {
      // The reviewer account's comp Pro subscription has a NULL
      // xendit_subscription_id; calling out for it would throw.
      prisma.subscription.findMany.mockResolvedValue([
        {
          id: 'sub-comp',
          planCode: 'pro',
          organizationId: 'org-solo',
          xenditSubscriptionId: null,
        },
      ]);

      await service.requestDeletion('user-1', dtoWithPassword(), {});

      expect(xendit.cancelSubscription).not.toHaveBeenCalled();
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-comp' },
          data: expect.objectContaining({ status: 'cancelled' }),
        }),
      );
    });

    it('calls Xendit when the subscription carries a plan id', async () => {
      prisma.subscription.findMany.mockResolvedValue([
        {
          id: 'sub-paid',
          planCode: 'pro',
          organizationId: 'org-solo',
          xenditSubscriptionId: 'xnd-plan-1',
        },
      ]);

      await service.requestDeletion('user-1', dtoWithPassword(), {});

      expect(xendit.cancelSubscription).toHaveBeenCalledWith('xnd-plan-1');
    });

    it('still cancels locally when Xendit is unreachable', async () => {
      prisma.subscription.findMany.mockResolvedValue([
        {
          id: 'sub-paid',
          planCode: 'pro',
          organizationId: 'org-solo',
          xenditSubscriptionId: 'xnd-plan-1',
        },
      ]);
      xendit.cancelSubscription.mockRejectedValue(new Error('502 Bad Gateway'));

      await expect(
        service.requestDeletion('user-1', dtoWithPassword(), {}),
      ).resolves.toMatchObject({ status: 'pending_deletion' });
      expect(prisma.subscription.update).toHaveBeenCalled();
    });
  });

  // ---- Cancel ----

  describe('cancelDeletion', () => {
    it('restores the account inside the window', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...passwordUser,
        status: 'pending_deletion',
        deletionRequestedAt: new Date(Date.now() - 3 * DAY_MS),
      });

      await expect(service.cancelDeletion('user-1')).resolves.toEqual({
        status: 'active',
      });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'active', deletionRequestedAt: null },
        }),
      );
    });

    it('refuses once the window has closed', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...passwordUser,
        status: 'pending_deletion',
        deletionRequestedAt: new Date(
          Date.now() - (DELETION_RESTORE_WINDOW_DAYS + 1) * DAY_MS,
        ),
      });

      await expect(service.cancelDeletion('user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('is a no-op for an already-active account', async () => {
      prisma.user.findUnique.mockResolvedValue(passwordUser);

      await expect(service.cancelDeletion('user-1')).resolves.toEqual({
        status: 'active',
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  // ---- Purge ----

  describe('purgeExpiredAccounts', () => {
    it('ignores rows still inside the restore window', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.purgeExpiredAccounts();

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('anonymizes the row and enqueues a keyed, idempotent purge job', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          email: 'juan@example.com',
          deletionRequestedAt: new Date(
            Date.now() - (DELETION_RESTORE_WINDOW_DAYS + 1) * DAY_MS,
          ),
        },
      ]);
      prisma.organizationMember.findMany.mockResolvedValue([]);

      await service.purgeExpiredAccounts();

      const update = prisma.user.update.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(update.data['fullName']).toBe('Deleted User');
      expect(update.data['email']).toMatch(
        /^deleted-[0-9a-f-]{36}@deleted\.libertasian\.com$/,
      );
      expect(update.data['passwordHash']).toBeNull();
      expect(update.data['googleId']).toBeNull();
      expect(update.data['appleId']).toBeNull();
      expect(update.data['mfaSecret']).toBeNull();
      expect(update.data['phone']).toBeNull();
      expect(update.data['status']).toBe('deleted');

      // A stable jobId is what makes a repeated tick idempotent.
      expect(queue.add).toHaveBeenCalledWith(
        'purge-user-content',
        { userId: 'user-1', organizationIds: [] },
        expect.objectContaining({ jobId: 'purge:user-1' }),
      );
    });

    it('keeps draining the batch when one row fails', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'bad', email: 'a@b.com', deletionRequestedAt: new Date(0) },
        { id: 'good', email: 'c@d.com', deletionRequestedAt: new Date(0) },
      ]);
      prisma.organizationMember.findMany.mockResolvedValue([]);
      prisma.user.update
        .mockRejectedValueOnce(new Error('deadlock'))
        .mockResolvedValue(undefined);

      await service.purgeExpiredAccounts();

      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(
        'purge-user-content',
        expect.objectContaining({ userId: 'good' }),
        expect.anything(),
      );
    });
  });
});
