/**
 * Prometheus metrics endpoint for the Next.js web app.
 *
 * Exposes Node.js default process metrics (event loop, GC, heap, CPU) at
 * `/metrics`. Resolves at `web:3000/metrics` and is scraped by Prometheus
 * directly inside the docker network — see
 * `infrastructure/monitoring/prometheus/prometheus.yml` (`nextjs-web` job).
 *
 * Public access via the nginx edge is blocked by an explicit
 * `location = /metrics { deny all; return 403; }` rule that precedes the
 * catch-all `location /` proxy to web.
 *
 * Hot-reload safety: `collectDefaultMetrics()` would throw on a duplicate
 * registration if the dev server re-evaluated this module. A module-level
 * boolean guards against that. We also use the singleton `register` from
 * `prom-client` so all calls share the same registry.
 */

import { collectDefaultMetrics, register } from 'prom-client';

// Force this route into the Node.js runtime — `prom-client` reads
// process/event-loop internals that aren't available in the Edge runtime.
export const runtime = 'nodejs';
// Always evaluate the handler dynamically — metrics are by definition fresh.
export const dynamic = 'force-dynamic';

const METRIC_PREFIX = 'libertasian_web_';

declare global {
  // eslint-disable-next-line no-var
  var __libertasianWebMetricsRegistered: boolean | undefined;
}

function ensureDefaultMetricsRegistered(): void {
  if (globalThis.__libertasianWebMetricsRegistered) return;
  collectDefaultMetrics({ prefix: METRIC_PREFIX, register });
  globalThis.__libertasianWebMetricsRegistered = true;
}

ensureDefaultMetricsRegistered();

export async function GET(): Promise<Response> {
  const body = await register.metrics();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': register.contentType,
      'Cache-Control': 'no-store',
    },
  });
}
