import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { verifyEmailTemplate } from './templates/verify-email';
import { resetPasswordTemplate } from './templates/reset-password';
import { memberInviteTemplate } from './templates/member-invite';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly appUrl: string;

  constructor(
    @InjectQueue('emails') private readonly emailQueue: Queue,
    private readonly config: ConfigService,
  ) {
    this.appUrl = this.config.get<string>('APP_URL', 'http://localhost:3000');
  }

  async sendVerificationEmail(
    email: string,
    fullName: string,
    token: string,
  ): Promise<void> {
    const verifyUrl = `${this.appUrl}/auth/verify-email?token=${token}`;
    const { subject, html } = verifyEmailTemplate({ fullName, verifyUrl });

    await this.enqueue({ to: email, subject, html });
    this.logger.log(`Verification email enqueued for ${this.redactEmail(email)}`);
  }

  async sendPasswordResetEmail(
    email: string,
    fullName: string,
    token: string,
  ): Promise<void> {
    const resetUrl = `${this.appUrl}/auth/reset-password?token=${token}`;
    const { subject, html } = resetPasswordTemplate({ fullName, resetUrl });

    await this.enqueue({ to: email, subject, html });
    this.logger.log(`Password reset email enqueued for ${this.redactEmail(email)}`);
  }

  async sendMemberInviteEmail(
    email: string,
    inviteeName: string,
    organizationName: string,
    inviterName: string,
  ): Promise<void> {
    const acceptUrl = `${this.appUrl}/organizations/accept-invite`;
    const { subject, html } = memberInviteTemplate({
      inviteeName,
      organizationName,
      inviterName,
      acceptUrl,
    });

    await this.enqueue({ to: email, subject, html });
    this.logger.log(`Member invite email enqueued for ${this.redactEmail(email)}`);
  }

  private async enqueue(data: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    await this.emailQueue.add('send-email', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }

  private redactEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '***@***';
    return `${local[0]}***@${domain}`;
  }
}
