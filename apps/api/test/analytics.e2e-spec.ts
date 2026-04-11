import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * Analytics E2E Tests
 *
 * Tests the full analytics pipeline:
 * 1. Event tracking endpoints (POST /analytics/events)
 * 2. Session lifecycle (start → heartbeat → end)
 * 3. Batch event tracking (mobile offline sync)
 * 4. Admin dashboard endpoints (GET /admin/analytics/*)
 * 5. Input validation
 * 6. Access control (admin-only dashboard)
 */
describe('Analytics (E2E)', () => {
  let app: INestApplication;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    app = await createTestApp();

    // Create admin user (admin dashboard requires owner/admin role)
    const admin = await createAuthenticatedUser(app, {
      email: `analytics-admin-${Date.now()}@libertasian-test.com`,
    });
    adminToken = admin.accessToken;

    // Create regular user
    const user = await createAuthenticatedUser(app, {
      email: `analytics-user-${Date.now()}@libertasian-test.com`,
    });
    userToken = user.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // Event Tracking
  // =========================================================================

  describe('POST /api/v1/analytics/events', () => {
    it('should accept a valid event and return 202', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/analytics/events')
        .set('x-device-type', 'web')
        .send({
          eventName: 'page_viewed',
          properties: { path: '/search' },
        })
        .expect(202);

      expect(res.body).toHaveProperty('success', true);
    });

    it('should accept event with all optional fields', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/analytics/events')
        .set('x-device-type', 'ios')
        .set('x-app-version', '2.0.1')
        .send({
          eventName: 'search_executed',
          sessionId: 'test-session-123',
          deviceType: 'ios',
          properties: {
            query_length: 15,
            search_type: 'fulltext',
            result_count: 42,
            has_zero_results: false,
          },
          durationMs: 350,
        })
        .expect(202);
    });

    it('should reject unknown event names with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/analytics/events')
        .send({
          eventName: 'totally_invalid_event',
          properties: {},
        })
        .expect(400);

      // track-event.dto.ts:22 uses class-validator `@IsIn(VALID_EVENT_NAMES)`
      // on eventName, so ValidationPipe now produces the standard
      // "eventName must be one of the following values: ..." message
      // instead of the old hand-written "Unknown event name" error.
      // res.body.message is an array from class-validator errors, so use
      // `expect.arrayContaining` with a substring matcher.
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('eventName must be one of the following values'),
        ]),
      );
    });

    it('should reject events with properties exceeding 10KB', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/analytics/events')
        .send({
          eventName: 'page_viewed',
          properties: { path: '/search', huge_data: 'x'.repeat(11000) },
        })
        .expect(400);
    });
  });

  describe('POST /api/v1/analytics/events/auth', () => {
    it('should accept authenticated events', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/analytics/events/auth')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          eventName: 'page_viewed',
          properties: { path: '/dashboard' },
        })
        .expect(202);
    });

    it('should reject unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/analytics/events/auth')
        .send({
          eventName: 'page_viewed',
          properties: { path: '/dashboard' },
        })
        .expect(401);
    });
  });

  // =========================================================================
  // Batch Event Tracking
  // =========================================================================

  describe('POST /api/v1/analytics/events/batch', () => {
    it('should accept a batch of valid events', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/analytics/events/batch')
        .send({
          events: [
            { eventName: 'page_viewed', properties: { path: '/search' } },
            { eventName: 'page_viewed', properties: { path: '/documents' } },
            {
              eventName: 'search_executed',
              properties: {
                query_length: 10,
                search_type: 'search',
                result_count: 5,
                has_zero_results: false,
              },
            },
          ],
        })
        .expect(202);
    });

    it('should reject batch with invalid event in it', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/analytics/events/batch')
        .send({
          events: [
            { eventName: 'page_viewed', properties: { path: '/' } },
            { eventName: 'invalid_event', properties: {} },
          ],
        })
        .expect(400);
    });
  });

  // =========================================================================
  // Session Lifecycle
  // =========================================================================

  describe('Session lifecycle', () => {
    let sessionId: string;

    it('POST /api/v1/analytics/sessions/start should create a session', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/analytics/sessions/start')
        .send({
          deviceType: 'web',
          entryPath: '/landing',
          referrer: 'https://google.com',
        })
        .expect(201);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('sessionId');
      sessionId = res.body.data.sessionId;
      expect(typeof sessionId).toBe('string');
    });

    it('POST /api/v1/analytics/sessions/heartbeat should extend session', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/analytics/sessions/heartbeat')
        .send({
          sessionId,
          currentPath: '/search',
        })
        .expect(204);
    });

    it('POST /api/v1/analytics/sessions/end should end session', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/analytics/sessions/end')
        .send({ sessionId })
        .expect(204);
    });

    it('should handle heartbeat for non-existent session gracefully', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/analytics/sessions/heartbeat')
        .send({
          sessionId: 'non-existent-session',
        })
        .expect(204);
    });
  });

  // =========================================================================
  // Admin Dashboard Endpoints
  // =========================================================================

  describe('Admin dashboard (requires admin role)', () => {
    const dashboardEndpoints = [
      '/api/v1/admin/analytics/overview',
      '/api/v1/admin/analytics/engagement',
      '/api/v1/admin/analytics/search',
      '/api/v1/admin/analytics/ai',
      '/api/v1/admin/analytics/digests',
      '/api/v1/admin/analytics/scans',
      '/api/v1/admin/analytics/study',
      '/api/v1/admin/analytics/workspace',
      '/api/v1/admin/analytics/revenue',
      '/api/v1/admin/analytics/ingestion',
      '/api/v1/admin/analytics/retention',
    ];

    for (const endpoint of dashboardEndpoints) {
      it(`GET ${endpoint} should reject unauthenticated requests`, async () => {
        await request(app.getHttpServer())
          .get(endpoint)
          .expect(401);
      });
    }

    it('GET /api/v1/admin/analytics/overview should return metrics with admin token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/analytics/overview')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
    });

    it('GET /api/v1/admin/analytics/overview should accept date range params', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/analytics/overview')
        .query({ from: '2026-03-01', to: '2026-03-31' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('GET /api/v1/admin/analytics/funnels/:name should return funnel data', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/analytics/funnels/scan_to_digest')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // =========================================================================
  // User Journey Funnel Verification
  // =========================================================================

  describe('User journey: search → result click → document → AI answer', () => {
    let journeySessionId: string;

    it('should track a full search-to-answer user journey', async () => {
      // 1. Start session
      const sessionRes = await request(app.getHttpServer())
        .post('/api/v1/analytics/sessions/start')
        .send({ deviceType: 'web', entryPath: '/search' })
        .expect(201);
      journeySessionId = sessionRes.body.data.sessionId;

      // 2. Execute search
      await request(app.getHttpServer())
        .post('/api/v1/analytics/events')
        .send({
          eventName: 'search_executed',
          sessionId: journeySessionId,
          properties: {
            query_length: 25,
            search_type: 'fulltext',
            result_count: 15,
            has_zero_results: false,
          },
        })
        .expect(202);

      // 3. Click search result
      await request(app.getHttpServer())
        .post('/api/v1/analytics/events')
        .send({
          eventName: 'search_result_clicked',
          sessionId: journeySessionId,
          properties: {
            result_position: 2,
            document_type: 'supreme_court_decision',
            document_id: 'doc-123',
          },
        })
        .expect(202);

      // 4. Open document
      await request(app.getHttpServer())
        .post('/api/v1/analytics/events')
        .send({
          eventName: 'document_opened',
          sessionId: journeySessionId,
          properties: {
            document_type: 'supreme_court_decision',
            document_id: 'doc-123',
            source: 'search_results',
          },
        })
        .expect(202);

      // 5. Request AI answer
      await request(app.getHttpServer())
        .post('/api/v1/analytics/events')
        .send({
          eventName: 'ai_answer_requested',
          sessionId: journeySessionId,
          properties: {
            query_length: 30,
            mode: 'answer',
          },
        })
        .expect(202);

      // 6. Receive AI answer
      await request(app.getHttpServer())
        .post('/api/v1/analytics/events')
        .send({
          eventName: 'ai_answer_received',
          sessionId: journeySessionId,
          properties: {
            response_time_ms: 2500,
            citation_count: 3,
            confidence_level: 'high',
            abstained: false,
          },
        })
        .expect(202);

      // 7. Provide feedback
      await request(app.getHttpServer())
        .post('/api/v1/analytics/events')
        .send({
          eventName: 'ai_answer_feedback',
          sessionId: journeySessionId,
          properties: {
            rating: 'helpful',
          },
        })
        .expect(202);

      // 8. End session
      await request(app.getHttpServer())
        .post('/api/v1/analytics/sessions/end')
        .send({ sessionId: journeySessionId })
        .expect(204);
    });
  });

  // =========================================================================
  // Scan-to-Digest Funnel Journey
  // =========================================================================

  describe('User journey: scan → OCR → digest → save', () => {
    it('should track a full scan-to-digest user journey', async () => {
      const sessionRes = await request(app.getHttpServer())
        .post('/api/v1/analytics/sessions/start')
        .send({ deviceType: 'ios', entryPath: '/scan' })
        .expect(201);
      const sessionId = sessionRes.body.data.sessionId;

      const scanEvents = [
        { eventName: 'scan_started', properties: { capture_mode: 'single' } },
        { eventName: 'scan_captured', properties: { page_count: 2, quality_score: 0.85, device_platform: 'ios' } },
        { eventName: 'scan_ocr_completed', properties: { text_length: 5000, ocr_confidence: 0.92, processing_time_ms: 3000 } },
        { eventName: 'scan_digest_generated', properties: { entitled: true, prompted_upgrade: false, confidence_score: 0.88 } },
        { eventName: 'scan_saved', properties: { privacy_level: 'private' } },
      ];

      for (const event of scanEvents) {
        await request(app.getHttpServer())
          .post('/api/v1/analytics/events')
          .send({ ...event, sessionId })
          .expect(202);
      }

      await request(app.getHttpServer())
        .post('/api/v1/analytics/sessions/end')
        .send({ sessionId })
        .expect(204);
    });
  });

  // =========================================================================
  // Input Validation
  // =========================================================================

  describe('Input validation', () => {
    it('should reject session start with invalid deviceType', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/analytics/sessions/start')
        .send({
          deviceType: 'invalid_device',
          entryPath: '/',
        })
        .expect(400);
    });

    it('should reject empty event name', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/analytics/events')
        .send({
          eventName: '',
          properties: {},
        })
        .expect(400);
    });

    it('should reject batch exceeding 100 events', async () => {
      const events = Array.from({ length: 101 }, () => ({
        eventName: 'page_viewed',
        properties: { path: '/' },
      }));

      await request(app.getHttpServer())
        .post('/api/v1/analytics/events/batch')
        .send({ events })
        .expect(400);
    });

    it('should reject heartbeat without sessionId', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/analytics/sessions/heartbeat')
        .send({})
        .expect(400);
    });

    it('should reject end session without sessionId', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/analytics/sessions/end')
        .send({})
        .expect(400);
    });
  });
});
