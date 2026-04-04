import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { EmailService, type EmailPayload } from './email.service';

@Processor('emails')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly emailService: EmailService) {
    super();
  }

  async process(job: Job<EmailPayload>): Promise<void> {
    this.logger.log(`Processing email job ${job.id} — ${job.data.subject}`);

    await this.emailService.send(job.data);
  }
}
