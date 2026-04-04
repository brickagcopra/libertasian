import { Injectable, Logger } from '@nestjs/common';

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
      await this.prisma.auditLog.create({
        data: {
          organizationId: entry.organizationId,
          actorUserId: entry.actorUserId,
          actorType: entry.actorType,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          metadataJson: (entry.metadata ?? {}) as Record<string, string | number | boolean>,
        },
      });
    } catch (err) {
      // Audit logging must never break the primary operation
      this.logger.error(`Failed to write audit log: ${entry.action}`, err);
    }
  }
}
