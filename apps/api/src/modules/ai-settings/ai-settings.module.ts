import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AiSettingsController } from './ai-settings.controller';
import { AiSettingsService } from './ai-settings.service';
import { ModelRunsController } from './model-runs.controller';

/**
 * AI Settings module — admin-managed LLM configuration.
 *
 * Depends on:
 * - PrismaModule (global) for DB access
 * - RedisModule (global) for caching and budget sync
 * - AuditModule for audit logging
 * - NotificationsModule (global) for budget alert emails and in-app notifications
 */
@Module({
  imports: [AuditModule],
  controllers: [AiSettingsController, ModelRunsController],
  providers: [AiSettingsService],
  exports: [AiSettingsService],
})
export class AiSettingsModule {}
