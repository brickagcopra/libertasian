import { Injectable, Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { PrismaService } from '../../prisma/prisma.service';

interface AuditLogEntry {
  organizationId?: string;
  actorUserId?: string;
  actorType: 'user' | 'admin' | 'system';
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    try {
      const metadata: Record<string, unknown> = { ...(entry.metadata ?? {}) };

      // Coerce non-UUID actorUserId into metadata so the DB column stays valid
      let actorUserId: string | undefined = entry.actorUserId;
      let actorType = entry.actorType;
      if (actorUserId && !isUUID(actorUserId)) {
        metadata.actor_label = actorUserId;
        actorUserId = undefined;
        if (actorType !== 'system') {
          actorType = 'system';
        }
      }

      // Coerce non-UUID entityId into metadata
      let entityId: string | undefined = entry.entityId;
      if (entityId && !isUUID(entityId)) {
        metadata.entity_key = entityId;
        entityId = undefined;
      }

      await this.prisma.auditLog.create({
        data: {
          organizationId: entry.organizationId,
          actorUserId,
          actorType,
          action: entry.action,
          entityType: entry.entityType,
          entityId,
          metadataJson: metadata as Record<string, string | number | boolean>,
        },
      });
    } catch (err) {
      // Audit logging must never break the primary operation
      this.logger.error(`Failed to write audit log: ${entry.action}`, err);
    }
  }
}
