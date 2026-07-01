import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sanitizeHtml = require('sanitize-html') as (dirty: string, options?: Record<string, unknown>) => string;
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from './notifications.service';

class SendAnnouncementDto {
  @ApiProperty({ description: 'Email subject line' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @ApiProperty({ description: 'Announcement title displayed in email body' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ description: 'HTML content (will be sanitized)' })
  @IsString()
  @IsNotEmpty()
  content!: string;

  @ApiPropertyOptional({ description: 'Call-to-action button text' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ctaText?: string;

  @ApiPropertyOptional({ description: 'Call-to-action button URL' })
  @IsOptional()
  @IsString()
  ctaUrl?: string;

  @ApiProperty({ description: 'Target audience for the announcement', enum: ['all', 'subscribers', 'free'] })
  @IsString()
  @IsIn(['all', 'subscribers', 'free'])
  targetAudience!: 'all' | 'subscribers' | 'free';
}

@ApiTags('Admin')
@Controller('admin/announcements')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions({ permissions: ['admin:settings'], mode: 'any' })
@ApiBearerAuth()
export class AdminAnnouncementsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  @Post('send')
  @ApiOperation({ summary: 'Send announcement email to users (admin only)' })
  async sendAnnouncement(
    @Body() dto: SendAnnouncementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // Sanitize HTML content — only allow basic formatting tags
    const sanitizedContent = sanitizeHtml(dto.content, {
      allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a'],
      allowedAttributes: {
        a: ['href'],
      },
    });

    // Determine target audience query
    const subscriptionFilter = this.getSubscriptionFilter(dto.targetAudience);

    // Fetch eligible user IDs
    const users = await this.prisma.user.findMany({
      where: {
        status: 'active',
        ...subscriptionFilter,
      },
      select: { id: true },
    });

    const userIds = users.map((u) => u.id);

    // Enqueue in batches of 50
    const BATCH_SIZE = 50;
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      await this.notificationsService.sendAnnouncement({
        userIds: batch,
        subject: dto.subject,
        title: dto.title,
        content: sanitizedContent,
        ctaText: dto.ctaText,
        ctaUrl: dto.ctaUrl,
      });
    }

    // Audit log
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'admin.announcement_sent',
      entityType: 'announcement',
      metadata: {
        subject: dto.subject,
        targetAudience: dto.targetAudience,
        recipientCount: userIds.length,
      },
    });

    return {
      success: true,
      data: {
        message: `Announcement enqueued for ${userIds.length} users`,
        recipientCount: userIds.length,
      },
    };
  }

  private getSubscriptionFilter(audience: 'all' | 'subscribers' | 'free'): Record<string, unknown> {
    if (audience === 'all') return {};
    if (audience === 'subscribers') {
      return {
        memberships: {
          some: {
            organization: {
              subscriptions: {
                some: {
                  status: 'active',
                  planCode: { not: 'free' },
                },
              },
            },
          },
        },
      };
    }
    // free
    return {
      memberships: {
        some: {
          organization: {
            subscriptions: {
              some: {
                status: 'active',
                planCode: 'free',
              },
            },
          },
        },
      },
    };
  }
}
