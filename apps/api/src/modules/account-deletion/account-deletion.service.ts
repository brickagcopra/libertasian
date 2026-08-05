import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';
import { Queue } from 'bullmq';
import { createHash, randomBytes, randomUUID } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from '../billing/payment-provider.interface';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ACCOUNT_PURGE_QUEUE,
  ANONYMIZED_EMAIL_DOMAIN,
  ANONYMIZED_FULL_NAME,
  DELETION_RESTORE_WINDOW_DAYS,
  PURGE_USER_CONTENT_JOB,
  USER_STATUS_ACTIVE,
  USER_STATUS_DELETED,
  USER_STATUS_PENDING_DELETION,
  type PurgeUserContentJobData,
} from './account-deletion.types';
import { DeleteAccountDto } from './dto/delete-account.dto';

/** Result of a successful deletion request. */
export interface DeletionRequestResult {
  status: typeof USER_STATUS_PENDING_DELETION;
  deletionRequestedAt: Date;
  /** When the row becomes eligible for anonymization + purge. */
  scheduledPurgeAt: Date;
  restoreWindowDays: number;
}

/** How many pending rows one cron tick anonymizes. Bounds a single tick. */
const PURGE_BATCH_SIZE = 100;

/**
 * Self-serve account deletion.
 *
 * Implements the policy published at /account-deletion: the account is
 * deactivated immediately, restorable for {@link DELETION_RESTORE_WINDOW_DAYS}
 * days, and permanently purged within that same window's end.
 *
 * The flow deliberately does NOT delete the `users` row. Audit logs are
 * append-only and reference `actor_user_id`, and billing records are retained
 * for 5 years; the row is anonymized in place instead so those foreign keys
 * stay valid while no personal data survives on it.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
    private readonly notificationsService: NotificationsService,
    @InjectQueue(ACCOUNT_PURGE_QUEUE) private readonly purgeQueue: Queue,
  ) {}

  // ---- Request ----

  /**
   * Deactivate the caller's account and start the restore window.
   *
   * Idempotent: a second call while already `pending_deletion` returns the
   * existing schedule rather than restarting the clock.
   */
  async requestDeletion(
    userId: string,
    dto: DeleteAccountDto,
    context: { ip?: string; userAgent?: string },
  ): Promise<DeletionRequestResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status === USER_STATUS_DELETED) {
      throw new NotFoundException('User not found');
    }

    if (
      user.status === USER_STATUS_PENDING_DELETION &&
      user.deletionRequestedAt
    ) {
      return this.describeRequest(user.deletionRequestedAt);
    }

    await this.verifyOwnership(user, dto);

    // Guard rail: refuse while the user still owns an org other people work in.
    // Returns the solo orgs (the user is their only active member), which are
    // marked for deletion alongside the account.
    const soloOrganizationIds = await this.assertNoAbandonedOrganizations(
      userId,
    );

    const requestedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          status: USER_STATUS_PENDING_DELETION,
          deletionRequestedAt: requestedAt,
        },
      });

      if (soloOrganizationIds.length > 0) {
        await tx.organization.updateMany({
          where: { id: { in: soloOrganizationIds }, deletedAt: null },
          data: { deletedAt: requestedAt },
        });
      }

      // Reuses the existing revoke-all path in AuthService. It runs on the
      // outer connection rather than `tx`, so it is not literally atomic with
      // the updates above — but it runs LAST inside the callback, so a failure
      // here rolls the status change back, and the one non-atomic outcome
      // (sessions revoked, status unchanged) only costs the user a re-login.
      await this.authService.revokeAllSessions(userId);
    });

    // Outside the transaction: cancelling a subscription can call the gateway, and a
    // slow third-party call must never hold a DB transaction open.
    await this.cancelSubscriptionsForOrganizations(soloOrganizationIds, userId);

    // The emailed link is what makes the published 30-day window real. The
    // in-session Undo dies with the caller's access token; this does not.
    await this.issueRestoreToken(userId, user.email, user.fullName, requestedAt);

    await this.auditService.log({
      actorUserId: userId,
      actorType: 'user',
      action: 'user.account_deletion_requested',
      entityType: 'user',
      entityId: userId,
      metadata: {
        email: this.redactEmail(user.email),
        organizationsMarked: soloOrganizationIds.length,
        restoreWindowDays: DELETION_RESTORE_WINDOW_DAYS,
        ip: context.ip ?? null,
        userAgent: (context.userAgent ?? '').substring(0, 200) || null,
      },
    });

    this.logger.log(
      `Account deletion requested for user ${userId} (${soloOrganizationIds.length} org(s) marked)`,
    );

    return this.describeRequest(requestedAt);
  }

  // ---- Restore ----

  /**
   * In-session Undo. Restores a `pending_deletion` account for the
   * authenticated caller, which only works while their existing access token
   * is still valid — see {@link restoreWithToken} for the other 30 days.
   */
  async cancelDeletion(userId: string): Promise<{ status: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status === USER_STATUS_ACTIVE) {
      // Idempotent: nothing to restore.
      return { status: USER_STATUS_ACTIVE };
    }

    this.assertRestorable(user);
    await this.restoreAccount(user, 'session');

    return { status: USER_STATUS_ACTIVE };
  }

  /**
   * Restore from the emailed single-use token.
   *
   * PUBLIC — there is no session to authenticate against, by design: the whole
   * point is that the account cannot log in. Possession of a 256-bit token
   * delivered to the account's own inbox is the proof of ownership, exactly as
   * it is for password reset.
   */
  async restoreWithToken(token: string): Promise<{ status: string }> {
    const tokenHash = this.hashToken(token);

    const record = await this.prisma.accountRestoreToken.findFirst({
      where: { tokenHash, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    // One message for unknown / already-used / expired. Distinguishing them
    // would tell an attacker holding a guessed token which guess was closer.
    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired restore link.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
    });
    if (!user) {
      throw new BadRequestException('Invalid or expired restore link.');
    }

    if (user.status === USER_STATUS_DELETED) {
      // The purge already ran: the row is anonymized and its content is gone.
      // Nothing here can bring it back, and saying so plainly is kinder than a
      // success page over an empty account.
      throw new BadRequestException(
        'This account has already been permanently deleted and cannot be restored.',
      );
    }

    if (user.status === USER_STATUS_ACTIVE) {
      // Already restored (in-session Undo, or support). Burn the token anyway
      // so it cannot be replayed later, and report success.
      await this.consumeToken(record.id);
      return { status: USER_STATUS_ACTIVE };
    }

    this.assertRestorable(user);

    await this.restoreAccount(user, 'email_token', record.id);

    return { status: USER_STATUS_ACTIVE };
  }

  /** Shared restore body for both entry points. */
  private async restoreAccount(
    user: { id: string; email: string; deletionRequestedAt: Date | null },
    source: 'session' | 'email_token',
    restoreTokenId?: string,
  ): Promise<void> {
    const requestedAt = user.deletionRequestedAt;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          status: USER_STATUS_ACTIVE,
          deletionRequestedAt: null,
        },
      });

      // Un-mark only the orgs marked by THIS request. Matching on the exact
      // timestamp keeps an unrelated earlier deletion from being undone.
      if (requestedAt) {
        await tx.organization.updateMany({
          where: { deletedAt: requestedAt, billingOwnerUserId: user.id },
          data: { deletedAt: null },
        });
      }

      // Single-use: burning the token inside the same transaction is what
      // makes a double-submit restore once rather than twice.
      if (restoreTokenId) {
        await tx.accountRestoreToken.update({
          where: { id: restoreTokenId },
          data: { usedAt: new Date() },
        });
      }

      // Any other outstanding link for this user is now meaningless.
      await tx.accountRestoreToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
    });

    await this.auditService.log({
      actorUserId: user.id,
      actorType: source === 'session' ? 'user' : 'system',
      action: 'user.account_deletion_cancelled',
      entityType: 'user',
      entityId: user.id,
      metadata: { email: this.redactEmail(user.email), source },
    });
  }

  /** Reject anything that is not a live, still-restorable deletion request. */
  private assertRestorable(user: {
    status: string;
    deletionRequestedAt: Date | null;
  }): void {
    if (
      user.status !== USER_STATUS_PENDING_DELETION ||
      !user.deletionRequestedAt
    ) {
      throw new BadRequestException(
        'This account is not pending deletion and cannot be restored.',
      );
    }

    if (this.purgeDueAt(user.deletionRequestedAt) <= new Date()) {
      throw new BadRequestException(
        `The ${DELETION_RESTORE_WINDOW_DAYS}-day restore window has closed.`,
      );
    }
  }

  private async consumeToken(id: string): Promise<void> {
    await this.prisma.accountRestoreToken.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  /**
   * Mint and email the restore link.
   *
   * The token expires at exactly the moment the purge cron becomes eligible to
   * run on this row — both derive from {@link purgeDueAt}, so the promise in
   * the email and the behaviour of the cron cannot drift apart.
   */
  private async issueRestoreToken(
    userId: string,
    email: string,
    fullName: string,
    requestedAt: Date,
  ): Promise<void> {
    const rawToken = randomBytes(32).toString('hex');

    await this.prisma.accountRestoreToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(rawToken),
        expiresAt: this.purgeDueAt(requestedAt),
      },
    });

    try {
      await this.notificationsService.sendAccountRestoreEmail(
        email,
        fullName || 'User',
        rawToken,
        DELETION_RESTORE_WINDOW_DAYS,
      );
    } catch (err) {
      // The deletion itself already succeeded and must not be rolled back over
      // a mail failure. The row survives; support can re-send from it.
      this.logger.error(
        `Failed to enqueue restore email for user ${userId}`,
        err,
      );
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  // ---- Purge ----

  /**
   * Anonymize accounts whose restore window has closed and enqueue the
   * private-content purge. Runs daily; each tick is bounded to
   * {@link PURGE_BATCH_SIZE} rows so a backlog drains over several days rather
   * than in one long transaction.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'account-deletion-purge' })
  async purgeExpiredAccounts(): Promise<void> {
    const cutoff = new Date(
      Date.now() - DELETION_RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const due = await this.prisma.user.findMany({
      where: {
        status: USER_STATUS_PENDING_DELETION,
        deletionRequestedAt: { not: null, lte: cutoff },
      },
      select: { id: true, email: true, deletionRequestedAt: true },
      orderBy: { deletionRequestedAt: 'asc' },
      take: PURGE_BATCH_SIZE,
    });

    if (due.length === 0) {
      return;
    }

    this.logger.log(`Purging ${due.length} account(s) past the restore window`);

    for (const row of due) {
      try {
        await this.anonymizeAndEnqueue(row.id, row.email);
      } catch (err) {
        // One bad row must not stall the rest of the batch; the next tick
        // retries it (the row is still pending_deletion).
        this.logger.error(
          `Failed to purge account ${row.id}: ${
            err instanceof Error ? err.message : 'Unknown error'
          }`,
        );
      }
    }
  }

  /**
   * Anonymize one user row and enqueue its content purge.
   *
   * Exposed (rather than private) so the cron body stays readable and so tests
   * can drive a single row without waiting on the schedule.
   */
  async anonymizeAndEnqueue(userId: string, previousEmail: string): Promise<void> {
    const now = new Date();
    const organizationIds = await this.soloOrganizationIdsFor(userId);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: `deleted-${randomUUID()}@${ANONYMIZED_EMAIL_DOMAIN}`,
        fullName: ANONYMIZED_FULL_NAME,
        phone: null,
        passwordHash: null,
        googleId: null,
        appleId: null,
        mfaSecret: null,
        mfaEnabled: false,
        status: USER_STATUS_DELETED,
        anonymizedAt: now,
        deletedAt: now,
      },
    });

    // The job is keyed by userId so a retried tick reuses the same job id
    // instead of queueing a second purge for the same account.
    const jobData: PurgeUserContentJobData = { userId, organizationIds };
    await this.purgeQueue.add(PURGE_USER_CONTENT_JOB, jobData, {
      jobId: `purge:${userId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: false,
    });

    await this.auditService.log({
      actorType: 'system',
      action: 'user.account_deletion_completed',
      entityType: 'user',
      entityId: userId,
      metadata: {
        email: this.redactEmail(previousEmail),
        organizationsPurged: organizationIds.length,
      },
    });
  }

  // ---- Guard rails ----

  /**
   * Prove the caller owns the account being deleted.
   *
   * Password accounts must supply the password. Social-only accounts (no
   * `passwordHash`) have nothing to compare, so they must echo the exact
   * account email instead.
   */
  private async verifyOwnership(
    user: { email: string; passwordHash: string | null },
    dto: DeleteAccountDto,
  ): Promise<void> {
    if (user.passwordHash) {
      if (!dto.password) {
        throw new BadRequestException(
          'Password is required to delete this account.',
        );
      }
      const valid = await bcrypt.compare(dto.password, user.passwordHash);
      if (!valid) {
        throw new UnauthorizedException('Incorrect password.');
      }
      return;
    }

    if (!dto.email) {
      throw new BadRequestException(
        'Confirm your account email address to delete this account.',
      );
    }
    if (dto.email.trim().toLowerCase() !== user.email.toLowerCase()) {
      throw new UnauthorizedException(
        'The email address does not match this account.',
      );
    }
  }

  /**
   * Refuse deletion while the user is the SOLE owner of an org that other
   * people are still active in — deleting would strand them with no one able
   * to administer the tenant.
   *
   * @returns ids of the user's solo orgs (no other active members), which the
   * caller marks for deletion.
   */
  private async assertNoAbandonedOrganizations(
    userId: string,
  ): Promise<string[]> {
    const ownerships = await this.prisma.organizationMember.findMany({
      where: { userId, role: 'owner', status: 'active' },
      select: {
        organizationId: true,
        organization: {
          select: {
            name: true,
            members: {
              where: { status: 'active', userId: { not: userId } },
              select: {
                role: true,
                user: { select: { fullName: true, email: true } },
              },
            },
          },
        },
      },
    });

    const soloOrganizationIds: string[] = [];

    for (const ownership of ownerships) {
      const others = ownership.organization.members;
      if (others.length === 0) {
        soloOrganizationIds.push(ownership.organizationId);
        continue;
      }

      // Another owner can take over, so the org is not abandoned. The leaving
      // user's membership is removed by the purge job.
      if (others.some((m) => m.role === 'owner')) {
        continue;
      }

      const named = others
        .slice(0, 5)
        .map((m) => `${m.user.fullName} (${this.redactEmail(m.user.email)})`)
        .join(', ');
      const remainder =
        others.length > 5 ? ` and ${others.length - 5} more` : '';

      throw new ConflictException(
        `You are the only owner of "${ownership.organization.name}", which still has ` +
          `${others.length} other active member(s): ${named}${remainder}. ` +
          'Transfer ownership to another member before deleting your account.',
      );
    }

    return soloOrganizationIds;
  }

  /** Solo orgs at purge time — recomputed rather than trusted from the request. */
  private async soloOrganizationIdsFor(userId: string): Promise<string[]> {
    const ownerships = await this.prisma.organizationMember.findMany({
      where: { userId, role: 'owner' },
      select: {
        organizationId: true,
        organization: {
          select: {
            members: {
              where: { status: 'active', userId: { not: userId } },
              select: { id: true },
            },
          },
        },
      },
    });

    return ownerships
      .filter((o) => o.organization.members.length === 0)
      .map((o) => o.organizationId);
  }

  // ---- Subscriptions ----

  /**
   * Cancel any live subscription on the orgs being deleted.
   *
   * The local row is always the source of truth. The gateway is called ONLY
   * when `providerSubscriptionId` is non-null: complimentary and comp-Pro grants
   * carry no gateway plan at all, and calling out would throw on a NULL id.
   */
  private async cancelSubscriptionsForOrganizations(
    organizationIds: string[],
    actorUserId: string,
  ): Promise<void> {
    if (organizationIds.length === 0) {
      return;
    }

    const live = await this.prisma.subscription.findMany({
      where: {
        organizationId: { in: organizationIds },
        status: {
          in: ['active', 'trialing', 'past_due', 'grace_period', 'cancelling', 'complimentary'],
        },
      },
      select: {
        id: true,
        planCode: true,
        organizationId: true,
        providerSubscriptionId: true,
      },
    });

    for (const sub of live) {
      if (sub.providerSubscriptionId) {
        try {
          await this.paymentProvider.cancelSubscription(sub.providerSubscriptionId);
        } catch (err) {
          // Never block the user's deletion on a third party. The local row is
          // authoritative and the plan can be reconciled later.
          this.logger.error(
            `Failed to cancel gateway plan ${sub.providerSubscriptionId} for subscription ${sub.id}`,
            err,
          );
        }
      }

      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'cancelled',
          cancelAtPeriodEnd: false,
          canceledAt: new Date(),
        },
      });

      await this.auditService.log({
        organizationId: sub.organizationId,
        actorUserId,
        actorType: 'user',
        action: 'subscription.cancelled',
        entityType: 'subscription',
        entityId: sub.id,
        metadata: {
          reason: 'account_deletion',
          planCode: sub.planCode,
          // Audit metadata key retained verbatim so historical rows stay queryable.
          xenditCancelled: sub.providerSubscriptionId !== null,
        },
      });
    }
  }

  // ---- Helpers ----

  private describeRequest(requestedAt: Date): DeletionRequestResult {
    return {
      status: USER_STATUS_PENDING_DELETION,
      deletionRequestedAt: requestedAt,
      scheduledPurgeAt: this.purgeDueAt(requestedAt),
      restoreWindowDays: DELETION_RESTORE_WINDOW_DAYS,
    };
  }

  private purgeDueAt(requestedAt: Date): Date {
    return new Date(
      requestedAt.getTime() +
        DELETION_RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
  }

  /** Redact email for audit logs per CLAUDE.md: j***@example.com */
  private redactEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '***';
    return `${local[0]}***@${domain}`;
  }
}
