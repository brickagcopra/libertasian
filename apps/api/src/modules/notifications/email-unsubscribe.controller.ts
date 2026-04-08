import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';

import { PrismaService } from '../../prisma/prisma.service';

const VALID_TYPES = ['subscriptionUpdates', 'announcements', 'blogNotifications'] as const;
type UnsubscribeType = (typeof VALID_TYPES)[number];

@ApiExcludeController()
@Controller('email')
export class EmailUnsubscribeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('unsubscribe')
  async unsubscribe(
    @Query('token') token: string,
    @Query('type') type: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!token || !type || !VALID_TYPES.includes(type as UnsubscribeType)) {
      res.status(400).send(this.renderHtml('Invalid Request', 'The unsubscribe link is invalid.'));
      return;
    }

    const pref = await this.prisma.emailPreference.findUnique({
      where: { unsubscribeToken: token },
    });

    if (!pref) {
      res.status(404).send(this.renderHtml('Not Found', 'The unsubscribe link is invalid or expired.'));
      return;
    }

    const updateData: Record<string, boolean> = {};
    updateData[type] = false;

    await this.prisma.emailPreference.update({
      where: { id: pref.id },
      data: updateData,
    });

    const typeLabels: Record<string, string> = {
      subscriptionUpdates: 'subscription updates',
      announcements: 'announcements',
      blogNotifications: 'blog notifications',
    };

    res.status(200).send(
      this.renderHtml(
        'Unsubscribed',
        `You have been unsubscribed from ${typeLabels[type] ?? type} emails. You can re-enable them anytime from your account settings.`,
      ),
    );
  }

  private renderHtml(title: string, message: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — LIBERTASIAN</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb;">
  <div style="max-width: 400px; text-align: center; padding: 40px 20px;">
    <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 16px;">${title}</h1>
    <p style="color: #6b7280; line-height: 1.5;">${message}</p>
    <p style="margin-top: 24px;">
      <a href="/" style="color: #2563eb; text-decoration: none;">Go to LIBERTASIAN</a>
    </p>
  </div>
</body>
</html>`.trim();
  }
}
