import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { verifyEmailTemplate } from './templates/verify-email';
import { resetPasswordTemplate } from './templates/reset-password';
import { memberInviteTemplate } from './templates/member-invite';
import { subscriptionConfirmationTemplate } from './templates/subscription-confirmation';
import { paymentReceiptTemplate } from './templates/payment-receipt';
import { paymentFailedTemplate } from './templates/payment-failed';
import { announcementTemplate } from './templates/announcement';
import { blogNotificationTemplate } from './templates/blog-notification';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly appUrl: string;

  constructor(
    @InjectQueue('emails') private readonly emailQueue: Queue,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.appUrl = this.config.get<string>('APP_URL', 'http://localhost:3000');
  }

  // ---- Existing Transactional Emails ----

  async sendVerificationEmail(
    email: string,
    fullName: string,
    code: string,
  ): Promise<void> {
    const { subject, html } = verifyEmailTemplate({ fullName, code });

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

  // ---- Subscription / Payment Emails ----

  async sendSubscriptionConfirmation(params: {
    email: string;
    userName: string;
    planName: string;
    billingPeriod: string;
    features: string[];
    nextBillingDate: string;
  }): Promise<void> {
    const dashboardUrl = `${this.appUrl}/dashboard`;
    const { subject, html } = subscriptionConfirmationTemplate({
      userName: params.userName,
      planName: params.planName,
      billingPeriod: params.billingPeriod,
      features: params.features,
      nextBillingDate: params.nextBillingDate,
      dashboardUrl,
    });

    await this.enqueue({ to: params.email, subject, html });
    this.logger.log(`Subscription confirmation enqueued for ${this.redactEmail(params.email)}`);
  }

  async sendPaymentReceipt(params: {
    email: string;
    userName: string;
    amount: string;
    currency: string;
    paymentMethod: string;
    invoiceNumber: string;
    date: string;
    planName: string;
  }): Promise<void> {
    const billingUrl = `${this.appUrl}/settings/billing`;
    const { subject, html } = paymentReceiptTemplate({
      userName: params.userName,
      amount: params.amount,
      currency: params.currency,
      paymentMethod: params.paymentMethod,
      invoiceNumber: params.invoiceNumber,
      date: params.date,
      planName: params.planName,
      billingUrl,
    });

    await this.enqueue({ to: params.email, subject, html });
    this.logger.log(`Payment receipt enqueued for ${this.redactEmail(params.email)}`);
  }

  async sendPaymentFailed(params: {
    email: string;
    userName: string;
    amount: string;
    retryDate: string;
  }): Promise<void> {
    const updatePaymentUrl = `${this.appUrl}/settings/billing`;
    const { subject, html } = paymentFailedTemplate({
      userName: params.userName,
      amount: params.amount,
      retryDate: params.retryDate,
      updatePaymentUrl,
    });

    await this.enqueue({ to: params.email, subject, html });
    this.logger.log(`Payment failed email enqueued for ${this.redactEmail(params.email)}`);
  }

  // ---- Announcement & Blog (preference-respecting bulk sends) ----

  async sendAnnouncement(params: {
    userIds: string[];
    subject: string;
    title: string;
    content: string; // Already sanitized by caller
    ctaText?: string;
    ctaUrl?: string;
  }): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: params.userIds }, status: 'active' },
      select: { id: true, email: true, fullName: true, emailPreference: true },
    });

    let enqueued = 0;
    for (const user of users) {
      // Check preference — skip if opted out
      if (user.emailPreference && !user.emailPreference.announcements) {
        continue;
      }

      const unsubscribeToken = user.emailPreference?.unsubscribeToken ?? '';
      const unsubscribeUrl = `${this.appUrl}/api/v1/email/unsubscribe?token=${unsubscribeToken}&type=announcements`;

      const { subject, html } = announcementTemplate({
        userName: user.fullName ?? 'User',
        title: params.title,
        content: params.content,
        ctaText: params.ctaText,
        ctaUrl: params.ctaUrl,
        unsubscribeUrl,
      });

      await this.enqueue({
        to: user.email,
        subject: params.subject, // Use custom subject from admin
        html,
      });
      enqueued++;
    }

    this.logger.log(`Announcement enqueued for ${enqueued}/${users.length} eligible users`);
  }

  async sendBlogNotification(params: {
    userIds: string[];
    postTitle: string;
    excerpt: string;
    authorName: string;
    publishDate: string;
    postUrl: string;
  }): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: params.userIds }, status: 'active' },
      select: { id: true, email: true, fullName: true, emailPreference: true },
    });

    let enqueued = 0;
    for (const user of users) {
      // Check preference — skip if opted out
      if (user.emailPreference && !user.emailPreference.blogNotifications) {
        continue;
      }

      const unsubscribeToken = user.emailPreference?.unsubscribeToken ?? '';
      const unsubscribeUrl = `${this.appUrl}/api/v1/email/unsubscribe?token=${unsubscribeToken}&type=blogNotifications`;

      const { subject, html } = blogNotificationTemplate({
        userName: user.fullName ?? 'User',
        postTitle: params.postTitle,
        excerpt: params.excerpt,
        authorName: params.authorName,
        publishDate: params.publishDate,
        postUrl: params.postUrl,
        unsubscribeUrl,
      });

      await this.enqueue({ to: user.email, subject, html });
      enqueued++;
    }

    this.logger.log(`Blog notification enqueued for ${enqueued}/${users.length} eligible users`);
  }

  // ---- Queue helpers ----

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
