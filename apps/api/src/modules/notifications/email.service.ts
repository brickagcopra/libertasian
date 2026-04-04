import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService) {
    const smtpHost = this.config.get<string>('SMTP_HOST');
    this.fromAddress = this.config.get<string>(
      'SMTP_FROM',
      'LIBERTASIAN <noreply@libertasian.com>',
    );

    if (smtpHost) {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: this.config.get<number>('SMTP_PORT', 587),
        secure: this.config.get<number>('SMTP_PORT', 587) === 465,
        auth: {
          user: this.config.get<string>('SMTP_USER', ''),
          pass: this.config.get<string>('SMTP_PASS', ''),
        },
      });
      this.logger.log(`SMTP transport configured: ${smtpHost}`);
    } else {
      this.logger.warn(
        'SMTP_HOST not configured — emails will be logged instead of sent',
      );
    }
  }

  async send(payload: EmailPayload): Promise<void> {
    const redactedTo = this.redactEmail(payload.to);

    if (!this.transporter) {
      this.logger.log(
        `[DEV] Email to ${redactedTo} | Subject: ${payload.subject}`,
      );
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      });
      this.logger.log(`Email sent to ${redactedTo} | Subject: ${payload.subject}`);
    } catch (err) {
      this.logger.error(
        `Failed to send email to ${redactedTo}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      throw err;
    }
  }

  /** Redact email for PII-safe logging: j***@example.com */
  private redactEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '***@***';
    return `${local[0]}***@${domain}`;
  }
}
