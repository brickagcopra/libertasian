import { Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

/**
 * MetricsModule
 *
 * Exposes Prometheus default metrics (Node.js process, event loop, GC, heap,
 * etc.) at `/api/v1/metrics`. The global prefix `api/v1` is applied in
 * `main.ts:48`, so configuring `path: '/metrics'` here is equivalent.
 *
 * Access model:
 *   - Inside docker network: scrapable directly (`api:3001/api/v1/metrics`).
 *   - Public edge: blocked by nginx (`location = /api/v1/metrics` returns 403).
 *
 * The endpoint is intentionally NOT guarded by JWT — there is no global auth
 * guard in this app, so simply omitting `@UseGuards(JwtAuthGuard)` (which is
 * done by PrometheusController internally) leaves it public.
 */
@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: {
        enabled: true,
        config: {
          prefix: 'libertasian_api_',
        },
      },
    }),
  ],
})
export class MetricsModule {}
