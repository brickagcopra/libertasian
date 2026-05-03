import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';

import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import {
  VALID_EVENT_NAMES_SET,
  getEventCategory,
  validateEventProperties,
  MAX_PROPERTIES_SIZE_BYTES,
} from './constants/event-taxonomy';

/** Shape of an event as enqueued to BullMQ */
export interface AnalyticsEventPayload {
  eventName: string;
  eventCategory: string;
  userId?: string;
  organizationId?: string;
  sessionId?: string;
  deviceType?: string;
  properties: Record<string, unknown>;
  metadata: Record<string, unknown>;
  durationMs?: number;
  createdAt: string; // ISO string
}

/** Session start data */
export interface SessionStartData {
  userId?: string;
  organizationId?: string;
  deviceType?: string;
  entryPath?: string;
  referrer?: string;
  properties?: Record<string, unknown>;
}

/** PII patterns to strip from event properties */
const PII_PATTERNS = [
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, // emails
  /\b(\+?63|0)\d{10}\b/g, // PH phone numbers
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, // generic phone numbers
];

const SESSION_EXPIRY_SECONDS = 30 * 60; // 30 minutes
const SESSION_REDIS_PREFIX = 'nest:analytics:session:';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @InjectQueue('analytics-events') private readonly eventQueue: Queue,
  ) {}

  // -----------------------------------------------------------------------
  // Core tracking
  // -----------------------------------------------------------------------

  /**
   * Track a single analytics event. Enqueues to BullMQ for async processing.
   * Never blocks the calling request.
   */
  async track(event: {
    eventName: string;
    userId?: string;
    organizationId?: string;
    sessionId?: string;
    deviceType?: string;
    properties: Record<string, unknown>;
    durationMs?: number;
    ipAddress?: string;
    userAgent?: string;
    appVersion?: string;
    screenResolution?: string;
  }): Promise<void> {
    // Validate event name against taxonomy whitelist
    if (!VALID_EVENT_NAMES_SET.has(event.eventName)) {
      throw new BadRequestException(`Unknown event name: ${event.eventName}`);
    }

    // Validate properties size (10 KB max)
    const propsJson = JSON.stringify(event.properties);
    if (Buffer.byteLength(propsJson, 'utf8') > MAX_PROPERTIES_SIZE_BYTES) {
      throw new BadRequestException('Event properties exceed 10KB limit');
    }

    // Validate required properties
    const missing = validateEventProperties(event.eventName, event.properties);
    if (missing.length > 0) {
      this.logger.warn(`Event ${event.eventName} missing properties: ${missing.join(', ')}`);
      // Warn but don't reject — allows for gradual adoption
    }

    // Strip PII from properties
    const sanitizedProperties = this.stripPii(event.properties);

    // Build metadata with hashed IP
    const metadata: Record<string, unknown> = {};
    if (event.userAgent) metadata['user_agent'] = event.userAgent;
    if (event.ipAddress) metadata['ip_hash'] = this.hashIp(event.ipAddress);
    if (event.appVersion) metadata['app_version'] = event.appVersion;
    if (event.screenResolution) metadata['screen_resolution'] = event.screenResolution;

    const payload: AnalyticsEventPayload = {
      eventName: event.eventName,
      eventCategory: getEventCategory(event.eventName) ?? 'navigation',
      userId: event.userId,
      organizationId: event.organizationId,
      sessionId: event.sessionId,
      deviceType: event.deviceType,
      properties: sanitizedProperties,
      metadata,
      durationMs: event.durationMs,
      createdAt: new Date().toISOString(),
    };

    // Enqueue — non-blocking
    await this.eventQueue.add('track', payload, {
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });

    // Increment session event count in Redis (fire-and-forget)
    if (event.sessionId) {
      this.redis
        .getClient()
        .hincrby(`${SESSION_REDIS_PREFIX}${event.sessionId}`, 'event_count', 1)
        .catch(() => { /* swallow Redis errors for analytics */ });
    }
  }

  /**
   * Track a batch of events (for mobile offline sync).
   */
  async trackBatch(events: Array<{
    eventName: string;
    sessionId?: string;
    deviceType?: string;
    properties: Record<string, unknown>;
    durationMs?: number;
  }>, context: {
    userId?: string;
    organizationId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    for (const event of events) {
      await this.track({
        ...event,
        userId: context.userId,
        organizationId: context.organizationId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Session management
  // -----------------------------------------------------------------------

  /**
   * Start a new analytics session. Returns session ID.
   */
  async startSession(data: SessionStartData): Promise<string> {
    const sessionId = crypto.randomUUID();

    // Store session in DB
    await this.prisma.analyticsSession.create({
      data: {
        id: sessionId,
        userId: data.userId,
        organizationId: data.organizationId,
        deviceType: data.deviceType,
        entryPath: data.entryPath,
        referrer: data.referrer,
        properties: (data.properties ?? {}) as Prisma.InputJsonValue,
      },
    });

    // Store in Redis for fast heartbeat/expiry tracking.
    // hset + expire MUST run in a single MULTI/EXEC so a crash between them
    // can't leave a TTL-less key behind under noeviction.
    const client = this.redis.getClient();
    const redisKey = `${SESSION_REDIS_PREFIX}${sessionId}`;
    await client
      .multi()
      .hset(redisKey, {
        user_id: data.userId ?? '',
        started_at: new Date().toISOString(),
        last_heartbeat: new Date().toISOString(),
        event_count: '0',
        page_count: '0',
      })
      .expire(redisKey, SESSION_EXPIRY_SECONDS)
      .exec();

    return sessionId;
  }

  /**
   * Session heartbeat — extends the session TTL.
   * Sessions auto-expire after 30 min of no heartbeat.
   */
  async heartbeat(sessionId: string, currentPath?: string): Promise<void> {
    const client = this.redis.getClient();
    const redisKey = `${SESSION_REDIS_PREFIX}${sessionId}`;

    const exists = await client.exists(redisKey);
    if (!exists) {
      // Session expired or never existed — silently ignore
      return;
    }

    // Atomic batch: hset + expire MUST execute together so a crash mid-call
    // can't strand the key without a TTL. Optional path/page_count updates
    // are queued on the same transaction to avoid partial-write inconsistency.
    const tx = client
      .multi()
      .hset(redisKey, 'last_heartbeat', new Date().toISOString())
      .expire(redisKey, SESSION_EXPIRY_SECONDS);

    if (currentPath) {
      tx.hset(redisKey, 'exit_path', currentPath);
      tx.hincrby(redisKey, 'page_count', 1);
    }

    await tx.exec();
  }

  /**
   * End a session explicitly. Computes duration and persists final state.
   */
  async endSession(sessionId: string): Promise<void> {
    const client = this.redis.getClient();
    const redisKey = `${SESSION_REDIS_PREFIX}${sessionId}`;

    const sessionData = await client.hgetall(redisKey);
    if (!sessionData || !sessionData['started_at']) {
      // Session already expired or doesn't exist
      return;
    }

    const startedAt = new Date(sessionData['started_at']);
    const endedAt = new Date();
    const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);

    await this.prisma.analyticsSession.update({
      where: { id: sessionId },
      data: {
        endedAt,
        durationSeconds,
        eventCount: parseInt(sessionData['event_count'] ?? '0', 10),
        pageCount: parseInt(sessionData['page_count'] ?? '0', 10),
        exitPath: sessionData['exit_path'] ?? null,
      },
    });

    // Clean up Redis
    await client.del(redisKey);
  }

  // -----------------------------------------------------------------------
  // Privacy helpers
  // -----------------------------------------------------------------------

  /**
   * Hash IP address with SHA-256, truncated to 8 characters.
   * Never store raw IPs.
   */
  private hashIp(ip: string): string {
    return createHash('sha256').update(ip).digest('hex').slice(0, 8);
  }

  /**
   * Strip PII (emails, phone numbers) from event properties.
   */
  private stripPii(properties: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(properties)) {
      if (typeof value === 'string') {
        let cleaned = value;
        for (const pattern of PII_PATTERNS) {
          cleaned = cleaned.replace(pattern, '[REDACTED]');
        }
        sanitized[key] = cleaned;
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.stripPii(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}
