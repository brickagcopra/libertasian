import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class SourcesScheduler {
  private readonly logger = new Logger(SourcesScheduler.name);

  constructor(
    @InjectQueue('source-health') private readonly healthQueue: Queue,
  ) {}

  /**
   * Trigger source health recompute every 6 hours.
   * Enqueues a BullMQ job so the work runs in the processor (off the scheduler thread).
   */
  @Cron('0 */6 * * *')
  async handleHealthCron() {
    this.logger.log('Scheduled source health recompute triggered');
    await this.healthQueue.add(
      'recompute-all',
      { triggeredBy: 'cron' },
      {
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    );
  }
}
