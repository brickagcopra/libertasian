import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AccountDeletionController } from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';
import { ACCOUNT_PURGE_QUEUE } from './account-deletion.types';
import { AccountPurgeProcessor } from './account-purge.processor';

/**
 * Self-serve account deletion (Apple 5.1.1(v) / Google Play data deletion).
 *
 * Separate from UsersModule because AuthModule already imports UsersModule —
 * reusing `AuthService.revokeAllSessions` from inside UsersModule would create
 * a cycle. This module sits downstream of both instead.
 *
 * PrismaService and AuditService come from their @Global modules; the
 * PAYMENT_PROVIDER adapter from BillingModule (only ever called for a non-null
 * providerSubscriptionId);
 * S3Service from UploadsModule for the object purge.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: ACCOUNT_PURGE_QUEUE }),
    AuthModule,
    BillingModule,
    UploadsModule,
    // NotificationsService emails the single-use restore link — the only thing
    // that makes the published 30-day window reachable after the session dies.
    NotificationsModule,
  ],
  controllers: [AccountDeletionController],
  providers: [AccountDeletionService, AccountPurgeProcessor],
  exports: [AccountDeletionService],
})
export class AccountDeletionModule {}
