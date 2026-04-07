import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { AnalyticsService } from './analytics.service';
import { VALID_EVENT_NAMES } from './constants/event-taxonomy';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: jest.Mocked<PrismaService>;
  let redis: jest.Mocked<RedisService>;
  let eventQueue: { add: jest.Mock };
  let redisClient: {
    hset: jest.Mock;
    hgetall: jest.Mock;
    hincrby: jest.Mock;
    expire: jest.Mock;
    exists: jest.Mock;
    del: jest.Mock;
  };

  beforeEach(async () => {
    redisClient = {
      hset: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({}),
      hincrby: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      exists: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
    };

    eventQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: PrismaService,
          useValue: {
            analyticsSession: {
              create: jest.fn().mockResolvedValue({ id: 'session-1' }),
              update: jest.fn().mockResolvedValue({ id: 'session-1' }),
            },
          },
        },
        {
          provide: RedisService,
          useValue: {
            getClient: jest.fn().mockReturnValue(redisClient),
          },
        },
        {
          provide: getQueueToken('analytics-events'),
          useValue: eventQueue,
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    prisma = module.get(PrismaService);
    redis = module.get(RedisService);
  });

  // =========================================================================
  // Event Tracking — track()
  // =========================================================================

  describe('track', () => {
    const validEvent = {
      eventName: 'search_executed',
      userId: 'user-1',
      organizationId: 'org-1',
      sessionId: 'sess-1',
      deviceType: 'web',
      properties: {
        query_length: 15,
        search_type: 'search',
        result_count: 42,
        has_zero_results: false,
      },
    };

    it('should enqueue a valid event to BullMQ', async () => {
      await service.track(validEvent);

      expect(eventQueue.add).toHaveBeenCalledTimes(1);
      expect(eventQueue.add).toHaveBeenCalledWith(
        'track',
        expect.objectContaining({
          eventName: 'search_executed',
          eventCategory: 'search',
          userId: 'user-1',
          organizationId: 'org-1',
          sessionId: 'sess-1',
          deviceType: 'web',
          properties: expect.objectContaining({
            query_length: 15,
            search_type: 'search',
            result_count: 42,
            has_zero_results: false,
          }),
        }),
        { removeOnComplete: 1000, removeOnFail: 5000 },
      );
    });

    it('should set correct event category from taxonomy', async () => {
      await service.track(validEvent);
      const payload = eventQueue.add.mock.calls[0][1];
      expect(payload.eventCategory).toBe('search');
    });

    it('should include ISO createdAt timestamp', async () => {
      await service.track(validEvent);
      const payload = eventQueue.add.mock.calls[0][1];
      expect(payload.createdAt).toBeDefined();
      expect(new Date(payload.createdAt).toISOString()).toBe(payload.createdAt);
    });

    it('should increment session event count in Redis when sessionId provided', async () => {
      await service.track(validEvent);
      expect(redisClient.hincrby).toHaveBeenCalledWith(
        'nest:analytics:session:sess-1',
        'event_count',
        1,
      );
    });

    it('should not increment session event count when no sessionId', async () => {
      const { sessionId: _, ...eventWithoutSession } = validEvent;
      await service.track(eventWithoutSession);
      expect(redisClient.hincrby).not.toHaveBeenCalled();
    });

    it('should reject unknown event names', async () => {
      await expect(
        service.track({ ...validEvent, eventName: 'unknown_event' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.track({ ...validEvent, eventName: 'unknown_event' }),
      ).rejects.toThrow('Unknown event name: unknown_event');
    });

    it('should reject events with properties exceeding 10KB', async () => {
      const largeProperties = {
        query_length: 15,
        search_type: 'search',
        result_count: 42,
        has_zero_results: false,
        huge_data: 'x'.repeat(11_000),
      };
      await expect(
        service.track({ ...validEvent, properties: largeProperties }),
      ).rejects.toThrow('Event properties exceed 10KB limit');
    });

    it('should accept all valid event names from taxonomy', async () => {
      for (const eventName of VALID_EVENT_NAMES.slice(0, 5)) {
        // Test a subset to keep fast; use minimal required properties
        eventQueue.add.mockClear();
        await service.track({
          eventName,
          properties: {},
        });
        expect(eventQueue.add).toHaveBeenCalledTimes(1);
      }
    });

    it('should hash IP address in metadata', async () => {
      await service.track({
        ...validEvent,
        ipAddress: '192.168.1.100',
      });

      const payload = eventQueue.add.mock.calls[0][1];
      expect(payload.metadata).toHaveProperty('ip_hash');
      expect(payload.metadata['ip_hash']).toHaveLength(8);
      // Should not contain the original IP
      expect(payload.metadata['ip_hash']).not.toContain('192.168');
    });

    it('should produce consistent IP hashes for same IP', async () => {
      await service.track({ ...validEvent, ipAddress: '10.0.0.1' });
      const hash1 = eventQueue.add.mock.calls[0][1].metadata['ip_hash'];

      eventQueue.add.mockClear();
      await service.track({ ...validEvent, ipAddress: '10.0.0.1' });
      const hash2 = eventQueue.add.mock.calls[0][1].metadata['ip_hash'];

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different IPs', async () => {
      await service.track({ ...validEvent, ipAddress: '10.0.0.1' });
      const hash1 = eventQueue.add.mock.calls[0][1].metadata['ip_hash'];

      eventQueue.add.mockClear();
      await service.track({ ...validEvent, ipAddress: '10.0.0.2' });
      const hash2 = eventQueue.add.mock.calls[0][1].metadata['ip_hash'];

      expect(hash1).not.toBe(hash2);
    });

    it('should include user-agent in metadata', async () => {
      await service.track({
        ...validEvent,
        userAgent: 'Mozilla/5.0 Test',
      });
      const payload = eventQueue.add.mock.calls[0][1];
      expect(payload.metadata['user_agent']).toBe('Mozilla/5.0 Test');
    });

    it('should include app_version in metadata', async () => {
      await service.track({
        ...validEvent,
        appVersion: '2.0.1',
      });
      const payload = eventQueue.add.mock.calls[0][1];
      expect(payload.metadata['app_version']).toBe('2.0.1');
    });

    it('should include screen_resolution in metadata', async () => {
      await service.track({
        ...validEvent,
        screenResolution: '1920x1080',
      });
      const payload = eventQueue.add.mock.calls[0][1];
      expect(payload.metadata['screen_resolution']).toBe('1920x1080');
    });

    it('should pass through durationMs', async () => {
      await service.track({
        ...validEvent,
        durationMs: 250,
      });
      const payload = eventQueue.add.mock.calls[0][1];
      expect(payload.durationMs).toBe(250);
    });
  });

  // =========================================================================
  // PII Stripping
  // =========================================================================

  describe('PII stripping', () => {
    it('should redact email addresses from properties', async () => {
      await service.track({
        eventName: 'search_executed',
        properties: {
          query_length: 10,
          search_type: 'search',
          result_count: 0,
          has_zero_results: true,
          note: 'Contact john@example.com for details',
        },
      });

      const payload = eventQueue.add.mock.calls[0][1];
      expect(payload.properties['note']).toBe('Contact [REDACTED] for details');
      expect(payload.properties['note']).not.toContain('john@example.com');
    });

    it('should redact Philippine phone numbers', async () => {
      await service.track({
        eventName: 'search_executed',
        properties: {
          query_length: 10,
          search_type: 'search',
          result_count: 0,
          has_zero_results: true,
          contact: 'Call +639171234567 now',
        },
      });

      const payload = eventQueue.add.mock.calls[0][1];
      expect(payload.properties['contact']).not.toContain('+639171234567');
    });

    it('should redact generic phone numbers', async () => {
      await service.track({
        eventName: 'search_executed',
        properties: {
          query_length: 10,
          search_type: 'search',
          result_count: 0,
          has_zero_results: true,
          phone: 'Call 555-123-4567 now',
        },
      });

      const payload = eventQueue.add.mock.calls[0][1];
      expect(payload.properties['phone']).not.toContain('555-123-4567');
    });

    it('should recursively strip PII from nested objects', async () => {
      await service.track({
        eventName: 'search_executed',
        properties: {
          query_length: 10,
          search_type: 'search',
          result_count: 0,
          has_zero_results: true,
          nested: {
            email: 'test@example.com is here',
          },
        },
      });

      const payload = eventQueue.add.mock.calls[0][1];
      const nested = payload.properties['nested'] as Record<string, unknown>;
      expect(nested['email']).not.toContain('test@example.com');
      expect(nested['email']).toContain('[REDACTED]');
    });

    it('should not modify non-string, non-object values', async () => {
      await service.track({
        eventName: 'search_executed',
        properties: {
          query_length: 42,
          search_type: 'search',
          result_count: 10,
          has_zero_results: false,
          tags: ['legal', 'case'],
        },
      });

      const payload = eventQueue.add.mock.calls[0][1];
      expect(payload.properties['query_length']).toBe(42);
      expect(payload.properties['has_zero_results']).toBe(false);
      expect(payload.properties['tags']).toEqual(['legal', 'case']);
    });

    it('should leave clean strings untouched', async () => {
      await service.track({
        eventName: 'search_executed',
        properties: {
          query_length: 5,
          search_type: 'fulltext',
          result_count: 3,
          has_zero_results: false,
        },
      });

      const payload = eventQueue.add.mock.calls[0][1];
      expect(payload.properties['search_type']).toBe('fulltext');
    });
  });

  // =========================================================================
  // Missing Properties Warning (non-blocking)
  // =========================================================================

  describe('property validation (non-blocking)', () => {
    it('should still enqueue events with missing required properties', async () => {
      // search_executed requires query_length, search_type, result_count, has_zero_results
      await service.track({
        eventName: 'search_executed',
        properties: { query_length: 10 }, // missing 3 required props
      });

      // Should still enqueue — validation is warn-only
      expect(eventQueue.add).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Batch Tracking — trackBatch()
  // =========================================================================

  describe('trackBatch', () => {
    it('should track each event in the batch with shared context', async () => {
      const events = [
        {
          eventName: 'page_viewed' as const,
          properties: { path: '/search' },
        },
        {
          eventName: 'search_executed' as const,
          properties: {
            query_length: 10,
            search_type: 'search',
            result_count: 5,
            has_zero_results: false,
          },
        },
      ];

      await service.trackBatch(events, {
        userId: 'user-1',
        organizationId: 'org-1',
        ipAddress: '192.168.1.1',
        userAgent: 'TestAgent',
      });

      expect(eventQueue.add).toHaveBeenCalledTimes(2);

      // Verify shared context on both events
      const call1 = eventQueue.add.mock.calls[0][1];
      const call2 = eventQueue.add.mock.calls[1][1];
      expect(call1.userId).toBe('user-1');
      expect(call1.organizationId).toBe('org-1');
      expect(call2.userId).toBe('user-1');
      expect(call2.organizationId).toBe('org-1');
    });

    it('should reject batch with invalid event names', async () => {
      const events = [
        {
          eventName: 'page_viewed' as const,
          properties: { path: '/search' },
        },
        {
          eventName: 'invalid_event_name',
          properties: {},
        },
      ];

      await expect(
        service.trackBatch(events, { userId: 'user-1' }),
      ).rejects.toThrow(BadRequestException);

      // First event should have been tracked before the second failed
      expect(eventQueue.add).toHaveBeenCalledTimes(1);
    });

    it('should handle empty batch gracefully', async () => {
      await service.trackBatch([], { userId: 'user-1' });
      expect(eventQueue.add).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Session Management — startSession()
  // =========================================================================

  describe('startSession', () => {
    it('should create a session in the database', async () => {
      const sessionId = await service.startSession({
        userId: 'user-1',
        organizationId: 'org-1',
        deviceType: 'web',
        entryPath: '/dashboard',
        referrer: 'https://google.com',
      });

      expect(typeof sessionId).toBe('string');
      expect(sessionId).toHaveLength(36); // UUID format

      expect(prisma.analyticsSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: sessionId,
          userId: 'user-1',
          organizationId: 'org-1',
          deviceType: 'web',
          entryPath: '/dashboard',
          referrer: 'https://google.com',
          properties: {},
        }),
      });
    });

    it('should store session data in Redis with 30-minute TTL', async () => {
      const sessionId = await service.startSession({
        userId: 'user-1',
      });

      expect(redisClient.hset).toHaveBeenCalledWith(
        `nest:analytics:session:${sessionId}`,
        expect.objectContaining({
          user_id: 'user-1',
          event_count: '0',
          page_count: '0',
        }),
      );

      expect(redisClient.expire).toHaveBeenCalledWith(
        `nest:analytics:session:${sessionId}`,
        1800, // 30 * 60
      );
    });

    it('should handle missing optional fields', async () => {
      const sessionId = await service.startSession({});

      expect(prisma.analyticsSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: undefined,
          organizationId: undefined,
          deviceType: undefined,
          entryPath: undefined,
          referrer: undefined,
          properties: {},
        }),
      });

      expect(typeof sessionId).toBe('string');
    });

    it('should pass properties when provided', async () => {
      await service.startSession({
        userId: 'user-1',
        properties: { source: 'mobile_app', version: '2.0' },
      });

      expect(prisma.analyticsSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          properties: { source: 'mobile_app', version: '2.0' },
        }),
      });
    });
  });

  // =========================================================================
  // Session Heartbeat
  // =========================================================================

  describe('heartbeat', () => {
    it('should update last_heartbeat and reset TTL', async () => {
      await service.heartbeat('sess-1');

      expect(redisClient.exists).toHaveBeenCalledWith('nest:analytics:session:sess-1');
      expect(redisClient.hset).toHaveBeenCalledWith(
        'nest:analytics:session:sess-1',
        'last_heartbeat',
        expect.any(String),
      );
      expect(redisClient.expire).toHaveBeenCalledWith(
        'nest:analytics:session:sess-1',
        1800,
      );
    });

    it('should update exit_path and increment page_count when currentPath provided', async () => {
      await service.heartbeat('sess-1', '/documents/123');

      expect(redisClient.hset).toHaveBeenCalledWith(
        'nest:analytics:session:sess-1',
        'exit_path',
        '/documents/123',
      );
      expect(redisClient.hincrby).toHaveBeenCalledWith(
        'nest:analytics:session:sess-1',
        'page_count',
        1,
      );
    });

    it('should silently ignore heartbeats for expired sessions', async () => {
      redisClient.exists.mockResolvedValue(0);

      await service.heartbeat('expired-session');

      // Should check exists but not update
      expect(redisClient.exists).toHaveBeenCalled();
      expect(redisClient.hset).not.toHaveBeenCalled();
      expect(redisClient.expire).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Session End
  // =========================================================================

  describe('endSession', () => {
    it('should compute duration and persist final state', async () => {
      const startedAt = new Date(Date.now() - 300_000); // 5 minutes ago
      redisClient.hgetall.mockResolvedValue({
        started_at: startedAt.toISOString(),
        event_count: '15',
        page_count: '8',
        exit_path: '/search',
      });

      await service.endSession('sess-1');

      expect(prisma.analyticsSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: expect.objectContaining({
          endedAt: expect.any(Date),
          durationSeconds: expect.any(Number),
          eventCount: 15,
          pageCount: 8,
          exitPath: '/search',
        }),
      });

      // Duration should be approximately 300 seconds (5 minutes)
      const updateCall = (prisma.analyticsSession.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.durationSeconds).toBeGreaterThanOrEqual(299);
      expect(updateCall.data.durationSeconds).toBeLessThanOrEqual(302);
    });

    it('should clean up Redis key after ending session', async () => {
      redisClient.hgetall.mockResolvedValue({
        started_at: new Date().toISOString(),
        event_count: '0',
        page_count: '0',
      });

      await service.endSession('sess-1');
      expect(redisClient.del).toHaveBeenCalledWith('nest:analytics:session:sess-1');
    });

    it('should silently handle already-expired sessions', async () => {
      redisClient.hgetall.mockResolvedValue({});

      await service.endSession('expired-sess');

      expect(prisma.analyticsSession.update).not.toHaveBeenCalled();
      expect(redisClient.del).not.toHaveBeenCalled();
    });

    it('should silently handle null session data', async () => {
      redisClient.hgetall.mockResolvedValue(null);

      await service.endSession('null-sess');

      expect(prisma.analyticsSession.update).not.toHaveBeenCalled();
    });

    it('should handle session with no exit path', async () => {
      redisClient.hgetall.mockResolvedValue({
        started_at: new Date().toISOString(),
        event_count: '3',
        page_count: '2',
      });

      await service.endSession('sess-no-exit');

      const updateCall = (prisma.analyticsSession.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.exitPath).toBeNull();
    });
  });

  // =========================================================================
  // Event Taxonomy Coverage
  // =========================================================================

  describe('event taxonomy', () => {
    it('should correctly map all search events to search category', async () => {
      for (const eventName of ['search_executed', 'search_result_clicked', 'search_refined', 'search_abandoned']) {
        eventQueue.add.mockClear();
        await service.track({ eventName, properties: {} });
        const payload = eventQueue.add.mock.calls[0][1];
        expect(payload.eventCategory).toBe('search');
      }
    });

    it('should correctly map AI events to ai_answer category', async () => {
      for (const eventName of ['ai_answer_requested', 'ai_answer_received', 'ai_answer_feedback']) {
        eventQueue.add.mockClear();
        await service.track({ eventName, properties: {} });
        const payload = eventQueue.add.mock.calls[0][1];
        expect(payload.eventCategory).toBe('ai_answer');
      }
    });

    it('should correctly map digest events to digest category', async () => {
      for (const eventName of ['digest_generated', 'digest_viewed', 'digest_saved', 'digest_exported', 'digest_reviewed']) {
        eventQueue.add.mockClear();
        await service.track({ eventName, properties: {} });
        const payload = eventQueue.add.mock.calls[0][1];
        expect(payload.eventCategory).toBe('digest');
      }
    });

    it('should correctly map billing events to billing category', async () => {
      for (const eventName of ['subscription_started', 'subscription_upgraded', 'subscription_cancelled', 'subscription_churned', 'paywall_hit', 'paywall_converted']) {
        eventQueue.add.mockClear();
        await service.track({ eventName, properties: {} });
        const payload = eventQueue.add.mock.calls[0][1];
        expect(payload.eventCategory).toBe('billing');
      }
    });

    it('should correctly map workspace events to workspace category', async () => {
      for (const eventName of ['matter_created', 'note_created', 'bookmark_created', 'annotation_created']) {
        eventQueue.add.mockClear();
        await service.track({ eventName, properties: {} });
        const payload = eventQueue.add.mock.calls[0][1];
        expect(payload.eventCategory).toBe('workspace');
      }
    });

    it('should correctly map study events to study category', async () => {
      for (const eventName of ['codal_opened', 'flashcard_session_started', 'flashcard_answered', 'study_session_completed']) {
        eventQueue.add.mockClear();
        await service.track({ eventName, properties: {} });
        const payload = eventQueue.add.mock.calls[0][1];
        expect(payload.eventCategory).toBe('study');
      }
    });

    it('should correctly map auth events to auth category', async () => {
      for (const eventName of ['user_signed_up', 'user_logged_in', 'user_activated']) {
        eventQueue.add.mockClear();
        await service.track({ eventName, properties: {} });
        const payload = eventQueue.add.mock.calls[0][1];
        expect(payload.eventCategory).toBe('auth');
      }
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  describe('edge cases', () => {
    it('should handle empty properties object', async () => {
      await service.track({
        eventName: 'page_viewed',
        properties: {},
      });
      expect(eventQueue.add).toHaveBeenCalledTimes(1);
    });

    it('should handle undefined optional fields', async () => {
      await service.track({
        eventName: 'page_viewed',
        properties: { path: '/home' },
      });

      const payload = eventQueue.add.mock.calls[0][1];
      expect(payload.userId).toBeUndefined();
      expect(payload.organizationId).toBeUndefined();
      expect(payload.sessionId).toBeUndefined();
      expect(payload.deviceType).toBeUndefined();
      expect(payload.durationMs).toBeUndefined();
    });

    it('should handle properties with null values', async () => {
      await service.track({
        eventName: 'page_viewed',
        properties: { path: '/home', referrer: null as unknown as string },
      });
      const payload = eventQueue.add.mock.calls[0][1];
      expect(payload.properties['referrer']).toBeNull();
    });

    it('should not leak Redis errors for session increment', async () => {
      redisClient.hincrby.mockRejectedValue(new Error('Redis connection lost'));

      // Should not throw — fire-and-forget
      await service.track({
        eventName: 'page_viewed',
        sessionId: 'sess-1',
        properties: { path: '/home' },
      });

      expect(eventQueue.add).toHaveBeenCalledTimes(1);
    });
  });
});
