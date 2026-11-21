import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { CommunitySanction, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationCenterService } from '../notifications/notification-center.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformGrantsService } from '../rbac/platform-grants.service';
import { CommunitySanctionsService } from './community-sanctions.service';
import {
  AUTO_HIDE_THRESHOLD,
  COMMUNITY_TARGET_TYPES,
  type CommunityTargetType,
  FEED_TARGET_TYPES,
  type ModerationActionType,
  type ModerationReason,
  type ModerationTargetType,
  type ModerationTypeFilter,
  QUEUE_SCAN_LIMIT,
  REASON_LABELS,
  RESOLVED_LOOKBACK_DAYS,
  RESTRICTIVE_SANCTIONS,
  SLA_HOURS,
  SLA_WARNING_HOURS,
  type SanctionType,
  TARGET_LABELS,
} from './moderation.constants';
import type { CreateSanctionDto, ListCasesQueryDto, ResolveCaseDto } from './dto/moderation.dto';

type ContentStatus = 'visible' | 'hidden' | 'removed' | 'deleted' | 'unknown';
type UserRef = { id: string; fullName: string };

interface LoadedTarget {
  authorId: string | null;
  author: UserRef | null;
  title: string | null;
  body: string | null;
  rawStatus: string | null;
  createdAt: Date | null;
  editedAt: Date | null;
  contentStatus: ContentStatus;
  /** Comments only: the parent post. */
  postId: string | null;
}

interface ReportRow {
  targetType: ModerationTargetType;
  targetId: string;
  reason: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

interface CaseGroup {
  targetType: ModerationTargetType;
  targetId: string;
  reportCount: number;
  reasons: Record<string, number>;
  firstReportedAt: Date;
  lastReportedAt: Date;
  resolution: 'dismissed' | 'actioned' | null;
  resolvedAt: Date | null;
}

const USER_REF = { select: { id: true, fullName: true } } as const;
const HOUR_MS = 3_600_000;
const PREVIEW_CHARS = 280;

function preview(text: string | null | undefined, max = PREVIEW_CHARS): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function isFeedType(t: ModerationTargetType): t is 'post' | 'comment' {
  return (FEED_TARGET_TYPES as readonly string[]).includes(t);
}

function typesForFilter(filter: ModerationTypeFilter | undefined): ModerationTargetType[] {
  if (!filter || filter === 'all') return [...FEED_TARGET_TYPES, ...COMMUNITY_TARGET_TYPES];
  if (filter === 'feed') return [...FEED_TARGET_TYPES];
  if (filter === 'community') return [...COMMUNITY_TARGET_TYPES];
  return [filter];
}

function feedStatus(status: string, deletedAt: Date | null): ContentStatus {
  if (deletedAt || status === 'removed_by_author') return 'deleted';
  if (status === 'published') return 'visible';
  if (status === 'hidden') return 'hidden';
  if (status === 'removed_by_admin') return 'removed';
  return 'unknown';
}

/**
 * Platform moderation queue (App Store Guideline 1.2).
 *
 * A CASE is one reported target (post, comment or community item) together
 * with every report filed against it; cases are derived by grouping the three
 * report tables, so no report data is copied. Resolving a case resolves all of
 * its open reports in one transaction and writes a ModerationAction row; the
 * audit log gets a parallel entry.
 */
@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notificationCenter: NotificationCenterService,
    private readonly notifications: NotificationsService,
    private readonly platformGrants: PlatformGrantsService,
  ) {}

  // ===========================================================================
  // Queue
  // ===========================================================================

  async listCases(query: ListCasesQueryDto) {
    const status = query.status ?? 'open';
    const types = typesForFilter(query.type);
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    let groups = this.group(await this.fetchReportRows(types, status), status);
    if (status === 'resolved') {
      // A target with a fresh open report is an open case, not a resolved one.
      const open = new Set(
        (await this.fetchReportRows(types, 'open')).map((r) => `${r.targetType}:${r.targetId}`),
      );
      groups = groups.filter((g) => !open.has(`${g.targetType}:${g.targetId}`));
    }

    const sort = query.sort ?? (status === 'open' ? 'oldest' : 'newest');
    groups.sort((a, b) => {
      if (sort === 'most_reported') {
        return b.reportCount - a.reportCount || a.firstReportedAt.getTime() - b.firstReportedAt.getTime();
      }
      const ka = status === 'resolved' ? (a.resolvedAt ?? a.lastReportedAt) : a.firstReportedAt;
      const kb = status === 'resolved' ? (b.resolvedAt ?? b.lastReportedAt) : b.firstReportedAt;
      return sort === 'newest' ? kb.getTime() - ka.getTime() : ka.getTime() - kb.getTime();
    });

    const page = groups.slice(offset, offset + limit);
    const targets = await this.loadTargetsFor(page);
    return {
      items: page.map((g) => this.toSummary(g, targets.get(`${g.targetType}:${g.targetId}`) ?? null, status)),
      total: groups.length,
      hasNext: offset + limit < groups.length,
    };
  }

  async getStats() {
    const now = Date.now();
    const types = typesForFilter('all');
    const openRows = await this.fetchReportRows(types, 'open');
    const open = this.group(openRows, 'open');
    const openKeys = new Set(open.map((g) => `${g.targetType}:${g.targetId}`));

    const weekAgo = new Date(now - 7 * 24 * HOUR_MS);
    const resolved = this.group(await this.fetchReportRows(types, 'resolved', weekAgo), 'resolved').filter(
      (g) => !openKeys.has(`${g.targetType}:${g.targetId}`),
    );
    const durations = resolved
      .map((g) => ((g.resolvedAt ?? g.lastReportedAt).getTime() - g.firstReportedAt.getTime()) / HOUR_MS)
      .sort((a, b) => a - b);
    const median =
      durations.length === 0
        ? null
        : durations.length % 2
          ? durations[(durations.length - 1) / 2]!
          : (durations[durations.length / 2 - 1]! + durations[durations.length / 2]!) / 2;

    const ageHours = (g: CaseGroup) => (now - g.firstReportedAt.getTime()) / HOUR_MS;
    const oldest = open.reduce<Date | null>(
      (min, g) => (min === null || g.firstReportedAt < min ? g.firstReportedAt : min),
      null,
    );

    const activeSanctions = await this.prisma.communitySanction.count({
      where: CommunitySanctionsService.activeWhere(new Date(now)),
    });

    return {
      openCases: open.length,
      openReports: openRows.length,
      overdueCases: open.filter((g) => ageHours(g) >= SLA_HOURS).length,
      dueSoonCases: open.filter((g) => ageHours(g) >= SLA_WARNING_HOURS && ageHours(g) < SLA_HOURS).length,
      oldestOpenAt: oldest?.toISOString() ?? null,
      resolvedLast7d: resolved.length,
      medianResolutionHours7d: median === null ? null : Math.round(median * 10) / 10,
      activeSanctions,
    };
  }

  async getCase(targetType: ModerationTargetType, targetId: string, moderatorId: string) {
    const [target, reports, history] = await Promise.all([
      this.loadTarget(targetType, targetId),
      this.fetchCaseReports(targetType, targetId),
      this.prisma.moderationAction.findMany({
        where: { targetType, targetId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { moderator: USER_REF, subjectUser: USER_REF },
      }),
    ]);
    if (!target && reports.length === 0) {
      throw new NotFoundException('Nothing to moderate here: no such content and no reports');
    }

    const openReports = reports.filter((r) => r.status === 'open');
    const counted = openReports.length > 0 ? openReports : reports;
    const group: CaseGroup = {
      targetType,
      targetId,
      reportCount: counted.length,
      reasons: this.countReasons(counted),
      firstReportedAt: counted.reduce((m, r) => (r.createdAt < m ? r.createdAt : m), counted[0]?.createdAt ?? new Date()),
      lastReportedAt: counted.reduce((m, r) => (r.createdAt > m ? r.createdAt : m), counted[0]?.createdAt ?? new Date()),
      resolution: openReports.length > 0 ? null : reports.some((r) => r.status === 'actioned') ? 'actioned' : reports.length ? 'dismissed' : null,
      resolvedAt:
        openReports.length > 0
          ? null
          : reports.reduce<Date | null>((m, r) => (r.resolvedAt && (!m || r.resolvedAt > m) ? r.resolvedAt : m), null),
    };
    const status = openReports.length > 0 || reports.length === 0 ? 'open' : 'resolved';

    let context = null;
    if (targetType === 'comment' && target?.postId) {
      const post = await this.loadTarget('post', target.postId);
      context = {
        targetType: 'post' as const,
        targetId: target.postId,
        preview: preview(post?.body ?? null),
        author: post?.author ?? null,
      };
    }

    const authorProfile = target?.authorId ? await this.getUserProfile(target.authorId) : null;
    const isOwn = target?.authorId === moderatorId;
    const cs = target?.contentStatus ?? 'unknown';

    return {
      ...this.toSummary(group, target, status),
      content: {
        title: target?.title ?? null,
        body: target?.body ?? null,
        rawStatus: target?.rawStatus ?? null,
        createdAt: target?.createdAt?.toISOString() ?? null,
        editedAt: target?.editedAt?.toISOString() ?? null,
      },
      context,
      reports: reports.map((r) => ({
        id: r.id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        reporter: r.reporter,
        resolvedBy: r.resolvedBy,
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolutionNote: r.resolutionNote,
      })),
      authorProfile,
      history: history.map((h) => this.toActionEntry(h)),
      canAct: !isOwn,
      canRemove: !isOwn && (cs === 'visible' || cs === 'hidden'),
      canRestore: !isOwn && (cs === 'removed' || cs === 'hidden'),
    };
  }

  // ===========================================================================
  // Case decisions
  // ===========================================================================

  async resolveCase(
    targetType: ModerationTargetType,
    targetId: string,
    dto: ResolveCaseDto,
    moderatorId: string,
  ) {
    const target = await this.loadTarget(targetType, targetId);
    if (target?.authorId === moderatorId) {
      throw new ForbiddenException("You can't moderate your own content");
    }

    const openCount = await this.countOpenReports(targetType, targetId);
    let action: ModerationActionType;
    let metadata: Record<string, unknown> = {};

    if (dto.decision === 'remove') {
      if (!target) throw new NotFoundException('That content no longer exists');
      if (target.contentStatus !== 'visible' && target.contentStatus !== 'hidden') {
        throw new BadRequestException(`This ${TARGET_LABELS[targetType]} is not live, so there is nothing to remove`);
      }
      action = 'remove';
    } else {
      if (openCount === 0) throw new BadRequestException('This case has no open reports to dismiss');
      action = 'dismiss';
    }

    const now = new Date();
    const reportStatus = action === 'remove' ? 'actioned' : 'dismissed';
    const reportsResolved = await this.prisma.$transaction(async (tx) => {
      if (action === 'remove') {
        metadata = await this.applyRemoval(tx, targetType, targetId);
      } else if (target?.contentStatus === 'hidden' && isFeedType(targetType)) {
        // Dismissing reports on auto-hidden content puts it back.
        await this.setFeedStatus(tx, targetType, targetId, 'published');
        metadata = { restoredFromAutoHide: true };
      }
      const resolved = await this.resolveOpenReports(tx, targetType, targetId, {
        status: reportStatus,
        resolvedByUserId: moderatorId,
        resolutionNote: dto.note ?? null,
        resolvedAt: now,
      });
      await tx.moderationAction.create({
        data: {
          moderatorUserId: moderatorId,
          subjectUserId: target?.authorId ?? null,
          targetType,
          targetId,
          action,
          reason: dto.reason ?? null,
          note: dto.note ?? null,
          reportsResolved: resolved,
          metadataJson: metadata as Prisma.InputJsonValue,
        },
      });
      return resolved;
    });

    await this.audit.log({
      actorUserId: moderatorId,
      actorType: 'admin',
      action: `moderation.${action}`,
      entityType: targetType,
      entityId: targetId,
      metadata: { reason: dto.reason ?? null, reportsResolved, ...metadata },
    });

    if (action === 'remove' && target?.authorId && dto.notifyAuthor !== false) {
      await this.notifyUser(
        target.authorId,
        `Your ${TARGET_LABELS[targetType]} was removed`,
        `A moderator removed it for breaking our Community Guidelines (${REASON_LABELS[dto.reason ?? 'other']}). Repeated violations can lead to suspension.`,
      );
    }

    return this.getCase(targetType, targetId, moderatorId);
  }

  async restoreContent(
    targetType: ModerationTargetType,
    targetId: string,
    note: string | undefined,
    moderatorId: string,
  ) {
    const target = await this.loadTarget(targetType, targetId);
    if (!target) throw new NotFoundException('That content no longer exists');
    if (target.authorId === moderatorId) {
      throw new ForbiddenException("You can't moderate your own content");
    }
    if (target.contentStatus !== 'removed' && target.contentStatus !== 'hidden') {
      throw new BadRequestException(`This ${TARGET_LABELS[targetType]} is not removed or hidden`);
    }

    const lastRemoval = await this.prisma.moderationAction.findFirst({
      where: { targetType, targetId, action: 'remove' },
      orderBy: { createdAt: 'desc' },
    });

    await this.prisma.$transaction(async (tx) => {
      await this.applyRestore(tx, targetType, targetId, (lastRemoval?.metadataJson ?? {}) as Record<string, unknown>);
      await tx.moderationAction.create({
        data: {
          moderatorUserId: moderatorId,
          subjectUserId: target.authorId,
          targetType,
          targetId,
          action: 'restore',
          note: note ?? null,
        },
      });
    });

    await this.audit.log({
      actorUserId: moderatorId,
      actorType: 'admin',
      action: 'moderation.restore',
      entityType: targetType,
      entityId: targetId,
      metadata: { previousStatus: target.contentStatus },
    });

    return this.getCase(targetType, targetId, moderatorId);
  }

  // ===========================================================================
  // Users & sanctions
  // ===========================================================================

  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, createdAt: true, status: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const [sanctions, posts, comments, removedPosts, removedComments, postReports, commentReports, upheldPost, upheldComment, history] =
      await Promise.all([
        this.prisma.communitySanction.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { user: USER_REF, issuedBy: USER_REF, revokedBy: USER_REF },
        }),
        this.prisma.feedPost.count({ where: { authorId: userId, deletedAt: null } }),
        this.prisma.feedComment.count({ where: { authorId: userId, deletedAt: null } }),
        this.prisma.feedPost.count({ where: { authorId: userId, status: 'removed_by_admin' } }),
        this.prisma.feedComment.count({ where: { authorId: userId, status: 'removed_by_admin' } }),
        this.prisma.feedPostReport.count({ where: { post: { authorId: userId } } }),
        this.prisma.feedCommentReport.count({ where: { comment: { authorId: userId } } }),
        this.prisma.feedPostReport.count({ where: { post: { authorId: userId }, status: 'actioned' } }),
        this.prisma.feedCommentReport.count({ where: { comment: { authorId: userId }, status: 'actioned' } }),
        this.prisma.moderationAction.findMany({
          where: { subjectUserId: userId },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { moderator: USER_REF, subjectUser: USER_REF },
        }),
      ]);

    const now = new Date();
    const mapped = sanctions.map((s) => this.toSanction(s, now));
    return {
      id: user.id,
      fullName: user.fullName,
      joinedAt: user.createdAt.toISOString(),
      accountStatus: user.status,
      activeSanction:
        mapped.filter((s) => s.active).sort((a, b) => (a.type === 'ban' ? -1 : b.type === 'ban' ? 1 : 0))[0] ?? null,
      sanctions: mapped,
      stats: {
        posts,
        comments,
        removedContent: removedPosts + removedComments,
        reportsAgainst: postReports + commentReports,
        upheldReports: upheldPost + upheldComment,
      },
      history: history.map((h) => this.toActionEntry(h)),
    };
  }

  async createSanction(userId: string, dto: CreateSanctionDto, moderatorId: string) {
    if (userId === moderatorId) throw new ForbiddenException("You can't sanction yourself");
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');
    if (dto.type === 'suspension' && !dto.durationDays) {
      throw new BadRequestException('A suspension needs a duration');
    }

    const now = new Date();
    const endsAt =
      dto.type === 'suspension' ? new Date(now.getTime() + dto.durationDays! * 24 * HOUR_MS) : null;
    const action: ModerationActionType =
      dto.type === 'warning' ? 'warn' : dto.type === 'suspension' ? 'suspend' : 'ban';

    const { sanction, removed } = await this.prisma.$transaction(async (tx) => {
      let superseded = 0;
      if ((RESTRICTIVE_SANCTIONS as readonly string[]).includes(dto.type)) {
        // The newest restriction replaces any running one, so "active" is never ambiguous.
        superseded = (
          await tx.communitySanction.updateMany({
            where: { userId, ...CommunitySanctionsService.activeWhere(now) },
            data: { revokedAt: now, revokedByUserId: moderatorId },
          })
        ).count;
      }
      const created = await tx.communitySanction.create({
        data: {
          userId,
          type: dto.type,
          reason: dto.reason,
          note: dto.note ?? null,
          startsAt: now,
          endsAt,
          issuedByUserId: moderatorId,
        },
        include: { user: USER_REF, issuedBy: USER_REF, revokedBy: USER_REF },
      });

      const removedCounts =
        dto.type === 'ban' && dto.removeContent ? await this.removeAllContent(tx, userId, moderatorId, now) : null;

      await tx.moderationAction.create({
        data: {
          moderatorUserId: moderatorId,
          subjectUserId: userId,
          targetType: 'user',
          targetId: userId,
          action,
          reason: dto.reason,
          note: dto.note ?? null,
          reportsResolved: removedCounts?.reportsResolved ?? 0,
          metadataJson: {
            sanctionId: created.id,
            durationDays: dto.durationDays ?? null,
            superseded,
            ...(removedCounts ?? {}),
          },
        },
      });
      return { sanction: created, removed: removedCounts };
    });

    await this.audit.log({
      actorUserId: moderatorId,
      actorType: 'admin',
      action: `moderation.${action}`,
      entityType: 'user',
      entityId: userId,
      metadata: { sanctionId: sanction.id, reason: dto.reason, durationDays: dto.durationDays ?? null, ...(removed ?? {}) },
    });

    if (dto.notifyUser !== false) {
      const reason = REASON_LABELS[dto.reason];
      if (dto.type === 'warning') {
        await this.notifyUser(
          userId,
          'A warning from LIBERTASIAN moderators',
          `Your recent community activity broke our Community Guidelines (${reason}). Further violations can lead to suspension or a ban.`,
        );
      } else if (dto.type === 'suspension') {
        await this.notifyUser(
          userId,
          `Your community access is suspended for ${dto.durationDays} day${dto.durationDays === 1 ? '' : 's'}`,
          `You can't post, comment or review until ${endsAt!.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })} (${reason}). The rest of the app works as usual.`,
        );
      } else {
        await this.notifyUser(
          userId,
          "You've been banned from the LIBERTASIAN community",
          `You can no longer post, comment or review (${reason}). The rest of the app works as usual.`,
        );
      }
    }

    return this.toSanction(sanction, new Date());
  }

  async revokeSanction(sanctionId: string, note: string | undefined, moderatorId: string) {
    const existing = await this.prisma.communitySanction.findUnique({ where: { id: sanctionId } });
    if (!existing) throw new NotFoundException('Sanction not found');
    if (existing.revokedAt) throw new BadRequestException('This sanction is already revoked');
    if (existing.userId === moderatorId) throw new ForbiddenException("You can't change your own sanction");

    const now = new Date();
    const wasActive = CommunitySanctionsService.isActive(existing, now);
    const updated = await this.prisma.$transaction(async (tx) => {
      const s = await tx.communitySanction.update({
        where: { id: sanctionId },
        data: { revokedAt: now, revokedByUserId: moderatorId },
        include: { user: USER_REF, issuedBy: USER_REF, revokedBy: USER_REF },
      });
      await tx.moderationAction.create({
        data: {
          moderatorUserId: moderatorId,
          subjectUserId: existing.userId,
          targetType: 'user',
          targetId: existing.userId,
          action: 'revoke_sanction',
          note: note ?? null,
          metadataJson: { sanctionId, sanctionType: existing.type },
        },
      });
      return s;
    });

    await this.audit.log({
      actorUserId: moderatorId,
      actorType: 'admin',
      action: 'moderation.revoke_sanction',
      entityType: 'user',
      entityId: existing.userId,
      metadata: { sanctionId, sanctionType: existing.type },
    });

    if (wasActive) {
      await this.notifyUser(
        existing.userId,
        'Your community access is restored',
        'A moderator lifted your restriction. You can post, comment and review again.',
      );
    }
    return this.toSanction(updated, now);
  }

  async listSanctions(opts: { active?: boolean; limit?: number; cursor?: string }) {
    const limit = opts.limit ?? 25;
    const now = new Date();
    const rows = await this.prisma.communitySanction.findMany({
      where: opts.active === false ? {} : CommunitySanctionsService.activeWhere(now),
      take: limit + 1,
      ...(opts.cursor && { skip: 1, cursor: { id: opts.cursor } }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { user: USER_REF, issuedBy: USER_REF, revokedBy: USER_REF },
    });
    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    return {
      items: page.map((s) => this.toSanction(s, now)),
      hasNext,
      nextCursor: hasNext ? page[page.length - 1]!.id : null,
    };
  }

  async listLog(opts: { limit?: number; cursor?: string }) {
    const limit = opts.limit ?? 50;
    const rows = await this.prisma.moderationAction.findMany({
      take: limit + 1,
      ...(opts.cursor && { skip: 1, cursor: { id: opts.cursor } }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { moderator: USER_REF, subjectUser: USER_REF },
    });
    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    return {
      items: page.map((r) => this.toActionEntry(r)),
      hasNext,
      nextCursor: hasNext ? page[page.length - 1]!.id : null,
    };
  }

  // ===========================================================================
  // Report intake hook (called by feed and community after a report is filed)
  // ===========================================================================

  /**
   * Runs after a report is stored. Emails moderators when a new case opens and
   * auto-hides a post/comment once AUTO_HIDE_THRESHOLD distinct users have
   * reported it. Never throws: a failure here must not fail the report.
   */
  async onReportFiled(targetType: ModerationTargetType, targetId: string): Promise<void> {
    try {
      const openReports = await this.countOpenReports(targetType, targetId);
      const target = await this.loadTarget(targetType, targetId);

      let autoHidden = false;
      if (isFeedType(targetType) && openReports >= AUTO_HIDE_THRESHOLD && target?.contentStatus === 'visible') {
        autoHidden = await this.prisma.$transaction(async (tx) => {
          const changed = await this.setFeedStatus(tx, targetType, targetId, 'hidden', 'published');
          if (changed === 0) return false;
          await tx.moderationAction.create({
            data: {
              moderatorUserId: null,
              subjectUserId: target.authorId,
              targetType,
              targetId,
              action: 'auto_hide',
              note: `Hidden automatically after ${openReports} reports, pending review.`,
              metadataJson: { openReports, threshold: AUTO_HIDE_THRESHOLD },
            },
          });
          return true;
        });
      }

      if (openReports === 1 || autoHidden) {
        const label = TARGET_LABELS[targetType];
        await this.alertModerators(
          autoHidden ? `A ${label} was auto-hidden after ${openReports} reports` : `New report on a ${label}`,
          [
            `Content: ${preview(target?.title ?? target?.body ?? null, 140) ?? '(no text)'}`,
            `Open reports on it: ${openReports}`,
          ],
          autoHidden,
        );
      }
    } catch (err) {
      this.logger.warn(
        `onReportFiled failed for ${targetType}:${targetId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 09:00 Asia/Manila: remind moderators of anything still open. */
  @Cron('0 1 * * *', { name: 'moderation-daily-summary', timeZone: 'UTC' })
  async sendDailySummary(): Promise<void> {
    try {
      const stats = await this.getStats();
      if (stats.openCases === 0) return;
      await this.alertModerators(
        `${stats.openCases} open report case${stats.openCases === 1 ? '' : 's'}`,
        [
          `Over 24 hours old: ${stats.overdueCases}`,
          `12–24 hours old: ${stats.dueSoonCases}`,
          `Open reports: ${stats.openReports}`,
        ],
        stats.overdueCases > 0,
      );
    } catch (err) {
      this.logger.warn(`Daily moderation summary failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ===========================================================================
  // Internals: reports
  // ===========================================================================

  private async fetchReportRows(
    types: ModerationTargetType[],
    status: 'open' | 'resolved',
    resolvedSince?: Date,
  ): Promise<ReportRow[]> {
    const since = resolvedSince ?? new Date(Date.now() - RESOLVED_LOOKBACK_DAYS * 24 * HOUR_MS);
    const where =
      status === 'open'
        ? { status: 'open' }
        : { status: { in: ['dismissed', 'actioned'] }, resolvedAt: { gte: since } };
    const select = { reason: true, status: true, createdAt: true, resolvedAt: true } as const;
    const rows: ReportRow[] = [];

    if (types.includes('post')) {
      const r = await this.prisma.feedPostReport.findMany({
        where,
        select: { ...select, postId: true },
        take: QUEUE_SCAN_LIMIT,
        orderBy: { createdAt: 'asc' },
      });
      rows.push(...r.map((x) => ({ ...x, targetType: 'post' as const, targetId: x.postId })));
    }
    if (types.includes('comment')) {
      const r = await this.prisma.feedCommentReport.findMany({
        where,
        select: { ...select, commentId: true },
        take: QUEUE_SCAN_LIMIT,
        orderBy: { createdAt: 'asc' },
      });
      rows.push(...r.map((x) => ({ ...x, targetType: 'comment' as const, targetId: x.commentId })));
    }
    const communityTypes = types.filter((t): t is CommunityTargetType =>
      (COMMUNITY_TARGET_TYPES as readonly string[]).includes(t),
    );
    if (communityTypes.length > 0) {
      const r = await this.prisma.communityFlag.findMany({
        where: { ...where, entityType: { in: communityTypes } },
        select: { ...select, entityType: true, entityId: true },
        take: QUEUE_SCAN_LIMIT,
        orderBy: { createdAt: 'asc' },
      });
      rows.push(
        ...r.map((x) => ({
          reason: x.reason,
          status: x.status,
          createdAt: x.createdAt,
          resolvedAt: x.resolvedAt,
          targetType: x.entityType as ModerationTargetType,
          targetId: x.entityId,
        })),
      );
    }
    return rows;
  }

  private group(rows: ReportRow[], status: 'open' | 'resolved'): CaseGroup[] {
    const map = new Map<string, CaseGroup>();
    for (const r of rows) {
      const key = `${r.targetType}:${r.targetId}`;
      let g = map.get(key);
      if (!g) {
        g = {
          targetType: r.targetType,
          targetId: r.targetId,
          reportCount: 0,
          reasons: {},
          firstReportedAt: r.createdAt,
          lastReportedAt: r.createdAt,
          resolution: status === 'open' ? null : 'dismissed',
          resolvedAt: null,
        };
        map.set(key, g);
      }
      g.reportCount += 1;
      g.reasons[r.reason] = (g.reasons[r.reason] ?? 0) + 1;
      if (r.createdAt < g.firstReportedAt) g.firstReportedAt = r.createdAt;
      if (r.createdAt > g.lastReportedAt) g.lastReportedAt = r.createdAt;
      if (status === 'resolved') {
        if (r.status === 'actioned') g.resolution = 'actioned';
        if (r.resolvedAt && (!g.resolvedAt || r.resolvedAt > g.resolvedAt)) g.resolvedAt = r.resolvedAt;
      }
    }
    return [...map.values()];
  }

  private countReasons(reports: Array<{ reason: string }>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of reports) out[r.reason] = (out[r.reason] ?? 0) + 1;
    return out;
  }

  private async fetchCaseReports(targetType: ModerationTargetType, targetId: string) {
    const include = { reporter: USER_REF, resolvedBy: USER_REF } as const;
    const orderBy = { createdAt: 'desc' } as const;
    if (targetType === 'post') {
      return this.prisma.feedPostReport.findMany({ where: { postId: targetId }, include, orderBy });
    }
    if (targetType === 'comment') {
      return this.prisma.feedCommentReport.findMany({ where: { commentId: targetId }, include, orderBy });
    }
    return this.prisma.communityFlag.findMany({
      where: { entityType: targetType, entityId: targetId },
      include,
      orderBy,
    });
  }

  private async countOpenReports(targetType: ModerationTargetType, targetId: string): Promise<number> {
    if (targetType === 'post') {
      return this.prisma.feedPostReport.count({ where: { postId: targetId, status: 'open' } });
    }
    if (targetType === 'comment') {
      return this.prisma.feedCommentReport.count({ where: { commentId: targetId, status: 'open' } });
    }
    return this.prisma.communityFlag.count({
      where: { entityType: targetType, entityId: targetId, status: 'open' },
    });
  }

  private async resolveOpenReports(
    tx: Prisma.TransactionClient,
    targetType: ModerationTargetType,
    targetId: string,
    data: { status: string; resolvedByUserId: string; resolutionNote: string | null; resolvedAt: Date },
  ): Promise<number> {
    if (targetType === 'post') {
      return (await tx.feedPostReport.updateMany({ where: { postId: targetId, status: 'open' }, data })).count;
    }
    if (targetType === 'comment') {
      return (await tx.feedCommentReport.updateMany({ where: { commentId: targetId, status: 'open' }, data }))
        .count;
    }
    return (
      await tx.communityFlag.updateMany({
        where: { entityType: targetType, entityId: targetId, status: 'open' },
        data,
      })
    ).count;
  }

  // ===========================================================================
  // Internals: targets
  // ===========================================================================

  private async loadTarget(targetType: ModerationTargetType, targetId: string): Promise<LoadedTarget | null> {
    return (await this.loadTargets(targetType, [targetId])).get(targetId) ?? null;
  }

  private async loadTargetsFor(groups: CaseGroup[]): Promise<Map<string, LoadedTarget>> {
    const byType = new Map<ModerationTargetType, string[]>();
    for (const g of groups) byType.set(g.targetType, [...(byType.get(g.targetType) ?? []), g.targetId]);
    const out = new Map<string, LoadedTarget>();
    for (const [type, ids] of byType) {
      for (const [id, t] of await this.loadTargets(type, ids)) out.set(`${type}:${id}`, t);
    }
    return out;
  }

  /**
   * Cross-org reads by design: moderation is platform-wide, so none of these
   * go through forTenant().
   */
  private async loadTargets(targetType: ModerationTargetType, ids: string[]): Promise<Map<string, LoadedTarget>> {
    const out = new Map<string, LoadedTarget>();
    if (ids.length === 0) return out;

    if (targetType === 'post') {
      const rows = await this.prisma.feedPost.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, authorId: true, textContent: true, status: true, deletedAt: true,
          createdAt: true, editedAt: true, author: USER_REF,
        },
      });
      for (const r of rows) {
        out.set(r.id, {
          authorId: r.authorId, author: r.author, title: null, body: r.textContent,
          rawStatus: r.deletedAt ? 'deleted' : r.status, createdAt: r.createdAt, editedAt: r.editedAt,
          contentStatus: feedStatus(r.status, r.deletedAt), postId: null,
        });
      }
      return out;
    }

    if (targetType === 'comment') {
      const rows = await this.prisma.feedComment.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, authorId: true, postId: true, textContent: true, status: true, deletedAt: true,
          createdAt: true, editedAt: true, author: USER_REF,
        },
      });
      for (const r of rows) {
        out.set(r.id, {
          authorId: r.authorId, author: r.author, title: null, body: r.textContent,
          rawStatus: r.deletedAt ? 'deleted' : r.status, createdAt: r.createdAt, editedAt: r.editedAt,
          contentStatus: feedStatus(r.status, r.deletedAt), postId: r.postId,
        });
      }
      return out;
    }

    // Community items have no "removed" column: a moderator removal unlists or
    // clears them, so the latest remove/restore action decides "removed".
    const lastActions = await this.prisma.moderationAction.findMany({
      where: { targetType, targetId: { in: ids }, action: { in: ['remove', 'restore'] } },
      orderBy: { createdAt: 'desc' },
      select: { targetId: true, action: true },
    });
    const removedIds = new Set<string>();
    const seen = new Set<string>();
    for (const a of lastActions) {
      if (seen.has(a.targetId)) continue;
      seen.add(a.targetId);
      if (a.action === 'remove') removedIds.add(a.targetId);
    }
    const studyStatus = (id: string, live: boolean): ContentStatus =>
      live ? 'visible' : removedIds.has(id) ? 'removed' : 'deleted';

    if (targetType === 'flashcard_set') {
      const rows = await this.prisma.flashcardSet.findMany({
        where: { id: { in: ids } },
        select: { id: true, userId: true, title: true, description: true, visibility: true, createdAt: true, user: USER_REF },
      });
      for (const r of rows) {
        out.set(r.id, {
          authorId: r.userId, author: r.user, title: r.title, body: r.description, rawStatus: r.visibility,
          createdAt: r.createdAt, editedAt: null,
          contentStatus: studyStatus(r.id, r.visibility === 'public_editorial'), postId: null,
        });
      }
    } else if (targetType === 'reviewer_pack') {
      const rows = await this.prisma.reviewerPack.findMany({
        where: { id: { in: ids } },
        select: { id: true, creatorUserId: true, title: true, description: true, visibility: true, createdAt: true, creator: USER_REF },
      });
      for (const r of rows) {
        out.set(r.id, {
          authorId: r.creatorUserId, author: r.creator, title: r.title, body: r.description, rawStatus: r.visibility,
          createdAt: r.createdAt, editedAt: null,
          contentStatus: studyStatus(r.id, r.visibility === 'public_editorial'), postId: null,
        });
      }
    } else if (targetType === 'digest') {
      const rows = await this.prisma.digest.findMany({
        where: { id: { in: ids } },
        select: { id: true, userId: true, title: true, facts: true, visibility: true, createdAt: true, user: USER_REF },
      });
      for (const r of rows) {
        out.set(r.id, {
          authorId: r.userId, author: r.user, title: r.title, body: r.facts, rawStatus: r.visibility,
          createdAt: r.createdAt, editedAt: null,
          contentStatus: studyStatus(r.id, r.visibility === 'public_editorial'), postId: null,
        });
      }
    } else {
      const rows = await this.prisma.communityRating.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, userId: true, score: true, reviewTitle: true, reviewBody: true,
          createdAt: true, updatedAt: true, user: USER_REF,
        },
      });
      for (const r of rows) {
        const hasText = Boolean(r.reviewTitle || r.reviewBody);
        out.set(r.id, {
          authorId: r.userId, author: r.user, title: r.reviewTitle, body: r.reviewBody, rawStatus: `${r.score}★`,
          createdAt: r.createdAt, editedAt: r.updatedAt,
          contentStatus: studyStatus(r.id, hasText), postId: null,
        });
      }
    }
    return out;
  }

  private async setFeedStatus(
    tx: Prisma.TransactionClient,
    targetType: 'post' | 'comment',
    targetId: string,
    status: string,
    onlyFrom?: string,
  ): Promise<number> {
    const where = { id: targetId, deletedAt: null, ...(onlyFrom ? { status: onlyFrom } : {}) };
    if (targetType === 'post') return (await tx.feedPost.updateMany({ where, data: { status } })).count;
    return (await tx.feedComment.updateMany({ where, data: { status } })).count;
  }

  /** Remove a target; returns what restore needs to undo it. */
  private async applyRemoval(
    tx: Prisma.TransactionClient,
    targetType: ModerationTargetType,
    targetId: string,
  ): Promise<Record<string, unknown>> {
    if (isFeedType(targetType)) {
      await this.setFeedStatus(tx, targetType, targetId, 'removed_by_admin');
      return {};
    }
    if (targetType === 'community_rating') {
      const r = await tx.communityRating.findUniqueOrThrow({ where: { id: targetId } });
      await tx.communityRating.update({ where: { id: targetId }, data: { reviewTitle: null, reviewBody: null } });
      // The removed text lives only here so a restore can put it back.
      return { previousReviewTitle: r.reviewTitle, previousReviewBody: r.reviewBody };
    }
    const data = { visibility: 'private' };
    if (targetType === 'flashcard_set') await tx.flashcardSet.update({ where: { id: targetId }, data });
    else if (targetType === 'reviewer_pack') await tx.reviewerPack.update({ where: { id: targetId }, data });
    else await tx.digest.update({ where: { id: targetId }, data });
    return { previousVisibility: 'public_editorial' };
  }

  private async applyRestore(
    tx: Prisma.TransactionClient,
    targetType: ModerationTargetType,
    targetId: string,
    removalMeta: Record<string, unknown>,
  ): Promise<void> {
    if (isFeedType(targetType)) {
      await this.setFeedStatus(tx, targetType, targetId, 'published');
      return;
    }
    if (targetType === 'community_rating') {
      await tx.communityRating.update({
        where: { id: targetId },
        data: {
          reviewTitle: (removalMeta['previousReviewTitle'] as string | null | undefined) ?? null,
          reviewBody: (removalMeta['previousReviewBody'] as string | null | undefined) ?? null,
        },
      });
      return;
    }
    const visibility = (removalMeta['previousVisibility'] as string | undefined) ?? 'public_editorial';
    if (targetType === 'flashcard_set') await tx.flashcardSet.update({ where: { id: targetId }, data: { visibility } });
    else if (targetType === 'reviewer_pack') await tx.reviewerPack.update({ where: { id: targetId }, data: { visibility } });
    else await tx.digest.update({ where: { id: targetId }, data: { visibility } });
  }

  /** Ban clean-up: take down everything the user has live in the community. */
  private async removeAllContent(
    tx: Prisma.TransactionClient,
    userId: string,
    moderatorId: string,
    now: Date,
  ) {
    const live = { authorId: userId, status: { in: ['published', 'hidden'] }, deletedAt: null };
    const posts = await tx.feedPost.findMany({ where: live, select: { id: true } });
    const comments = await tx.feedComment.findMany({ where: live, select: { id: true } });
    const removedPosts = (await tx.feedPost.updateMany({ where: live, data: { status: 'removed_by_admin' } })).count;
    const removedComments = (await tx.feedComment.updateMany({ where: live, data: { status: 'removed_by_admin' } }))
      .count;
    const unlisted =
      (await tx.flashcardSet.updateMany({ where: { userId, visibility: 'public_editorial' }, data: { visibility: 'private' } }))
        .count +
      (await tx.reviewerPack.updateMany({
        where: { creatorUserId: userId, visibility: 'public_editorial' },
        data: { visibility: 'private' },
      })).count;

    const resolution = {
      status: 'actioned',
      resolvedByUserId: moderatorId,
      resolutionNote: 'Resolved by a community ban of the author',
      resolvedAt: now,
    };
    const reportsResolved =
      (await tx.feedPostReport.updateMany({ where: { postId: { in: posts.map((p) => p.id) }, status: 'open' }, data: resolution }))
        .count +
      (await tx.feedCommentReport.updateMany({
        where: { commentId: { in: comments.map((c) => c.id) }, status: 'open' },
        data: resolution,
      })).count;

    return { removedPosts, removedComments, unlistedStudyItems: unlisted, reportsResolved };
  }

  // ===========================================================================
  // Internals: output & side effects
  // ===========================================================================

  private toSummary(g: CaseGroup, target: LoadedTarget | null, status: 'open' | 'resolved') {
    const contentStatus = target?.contentStatus ?? 'unknown';
    return {
      targetType: g.targetType,
      targetId: g.targetId,
      reportCount: g.reportCount,
      reasons: g.reasons,
      firstReportedAt: g.firstReportedAt.toISOString(),
      lastReportedAt: g.lastReportedAt.toISOString(),
      preview: preview(target?.title ?? target?.body ?? null),
      author: target?.author ?? null,
      contentStatus,
      autoHidden: contentStatus === 'hidden',
      status,
      resolution: status === 'open' ? null : g.resolution,
      resolvedAt: status === 'open' ? null : (g.resolvedAt?.toISOString() ?? null),
    };
  }

  private toSanction(
    s: CommunitySanction & { user: UserRef; issuedBy: UserRef | null; revokedBy: UserRef | null },
    now: Date,
  ) {
    return {
      id: s.id,
      user: s.user,
      type: s.type as SanctionType,
      reason: s.reason as ModerationReason,
      note: s.note,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt?.toISOString() ?? null,
      revokedAt: s.revokedAt?.toISOString() ?? null,
      issuedBy: s.issuedBy,
      revokedBy: s.revokedBy,
      createdAt: s.createdAt.toISOString(),
      active: CommunitySanctionsService.isActive(s, now),
    };
  }

  private toActionEntry(a: {
    id: string;
    action: string;
    targetType: string;
    targetId: string;
    reason: string | null;
    note: string | null;
    reportsResolved: number;
    createdAt: Date;
    moderator: UserRef | null;
    subjectUser: UserRef | null;
  }) {
    return {
      id: a.id,
      action: a.action as ModerationActionType,
      targetType: a.targetType as ModerationTargetType | 'user',
      targetId: a.targetId,
      subjectUser: a.subjectUser,
      moderator: a.moderator,
      reason: a.reason as ModerationReason | null,
      note: a.note,
      reportsResolved: a.reportsResolved,
      createdAt: a.createdAt.toISOString(),
    };
  }

  private async notifyUser(userId: string, title: string, body: string): Promise<void> {
    try {
      // entityType 'moderation' has no mobile route, so tapping it opens
      // nothing instead of a removed post's 404.
      await this.notificationCenter.createNotification({ userId, type: 'moderation', title, body, entityType: 'moderation' });
    } catch (err) {
      this.logger.warn(`Moderation notice to ${userId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async alertModerators(heading: string, lines: string[], urgent: boolean): Promise<void> {
    const moderators = await this.platformGrants.listUsersWithPlatformPermission('community:moderate');
    await Promise.all(
      moderators.map((m) =>
        this.notifications
          .sendModerationAlert({ email: m.email, fullName: m.fullName, heading, lines, urgent })
          .catch((err: unknown) =>
            this.logger.warn(`Moderation alert failed: ${err instanceof Error ? err.message : String(err)}`),
          ),
      ),
    );
  }
}
