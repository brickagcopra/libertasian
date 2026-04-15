import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { AuditService } from '../audit/audit.service';
import { SourcesService } from './sources.service';

interface HealthJobData {
  triggeredBy: 'cron' | 'manual';
}

@Processor('source-health')
export class SourcesHealthProcessor extends WorkerHost {
  private readonly logger = new Logger(SourcesHealthProcessor.name);

  constructor(
    private readonly sourcesService: SourcesService,
    private readonly auditService: AuditService,
  ) {
    super();
  }

  async process(job: Job<HealthJobData>): Promise<void> {
    this.logger.log(
      `Processing source health recompute job=${job.id} triggeredBy=${job.data.triggeredBy}`,
    );

    const reports = await this.sourcesService.computeAllSourceHealth();

    // Identify unhealthy sources (score < 0.5)
    const unhealthy = reports.filter(
      (r) => typeof r.healthScore === 'number' && r.healthScore < 0.5,
    );

    if (unhealthy.length > 0) {
      this.logger.warn(
        `Unhealthy sources detected: ${unhealthy.map((r) => `${r.sourceName ?? r.sourceId}(${r.healthScore})`).join(', ')}`,
      );
    }

    // Audit log the automated health check
    await this.auditService.log({
      actorType: 'system',
      action: 'source_health.automated_recompute',
      entityType: 'source',
      metadata: {
        actor_label: 'system',
        entity_key: 'all',
        triggeredBy: job.data.triggeredBy,
        totalSources: reports.length,
        unhealthyCount: unhealthy.length,
        unhealthySources: unhealthy.map((r) => ({
          id: r.sourceId,
          name: r.sourceName,
          score: r.healthScore,
        })),
      },
    });

    this.logger.log(
      `Source health recompute completed: total=${reports.length}, unhealthy=${unhealthy.length}`,
    );
  }
}
