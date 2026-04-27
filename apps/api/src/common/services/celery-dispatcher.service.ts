import { randomUUID } from 'crypto';
import { hostname } from 'os';

import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from './redis.service';

/**
 * Minimal Celery v2 message-protocol dispatcher.
 *
 * Pushes a Celery task message directly onto the broker's Redis queue so
 * a Python worker can pick it up via the normal ``shared_task`` machinery,
 * without NestJS having to import any Python code or run a Celery client.
 *
 * Why we built this: NestJS handlers like
 * ``BackfillService.create({startImmediately: true})`` need to fire a
 * Celery task synchronously, but until now the only fallback was the
 * worker's 5-minute "rescue stuck enumerating" sweep. That meant every
 * batch created through the admin UI sat idle for ~5 min before
 * enumeration even started — visible to operators as "the batch is
 * created but doing nothing." This dispatcher closes the gap: dispatch
 * fires inside the same request, the rescue sweep stays as a safety net
 * for batches inserted via raw SQL or whose dispatch crashed mid-flight.
 *
 * Wire format references:
 *   - Celery task message protocol v2: https://docs.celeryproject.org/en/stable/internals/protocol.html
 *   - Kombu Redis transport: https://docs.celeryproject.org/projects/kombu/en/stable/reference/kombu.transport.redis.html
 *
 * The message envelope kombu writes to Redis is a JSON object with three
 * top-level fields: ``body`` (base64-encoded JSON of
 * ``[args, kwargs, embed]``), ``headers`` (task name, id, etc.), and
 * ``properties`` (delivery metadata). The worker's celery-app
 * configuration determines the queue name; both NestJS and the worker
 * default to ``celery`` for now.
 */
@Injectable()
export class CeleryDispatcherService {
  private readonly logger = new Logger(CeleryDispatcherService.name);

  /**
   * Default queue name. Matches the worker's ``celery_app.py`` — neither
   * side overrides ``task_default_queue``, so kombu uses ``celery``.
   */
  private static readonly DEFAULT_QUEUE = 'celery';

  /** Cached origin string for headers — pid + hostname, computed once. */
  private readonly origin = `${process.pid}@${hostname()}`;

  constructor(private readonly redis: RedisService) {}

  /**
   * Send a Celery task to the broker. Returns the task id so callers can
   * log / store it for trace correlation. Does NOT wait for the worker
   * to pick up or complete the task — fire-and-forget by design.
   */
  async sendTask(
    taskName: string,
    options: {
      args?: unknown[];
      kwargs?: Record<string, unknown>;
      queue?: string;
    } = {},
  ): Promise<string> {
    const args = options.args ?? [];
    const kwargs = options.kwargs ?? {};
    const queue = options.queue ?? CeleryDispatcherService.DEFAULT_QUEUE;

    const taskId = randomUUID();
    const correlationId = taskId;

    // Body is [args, kwargs, embed] JSON, base64-encoded. ``embed`` carries
    // chord/chain metadata; we never use it from NestJS so it stays empty.
    const embed = { callbacks: null, errbacks: null, chain: null, chord: null };
    const bodyJson = JSON.stringify([args, kwargs, embed]);
    const body = Buffer.from(bodyJson, 'utf-8').toString('base64');

    const envelope = {
      body,
      'content-encoding': 'utf-8',
      'content-type': 'application/json',
      headers: {
        lang: 'py',
        task: taskName,
        id: taskId,
        shadow: null,
        eta: null,
        expires: null,
        group: null,
        group_index: null,
        retries: 0,
        timelimit: [null, null],
        root_id: taskId,
        parent_id: null,
        argsrepr: this.repr(args),
        kwargsrepr: this.repr(kwargs),
        origin: this.origin,
      },
      properties: {
        correlation_id: correlationId,
        reply_to: '',
        delivery_mode: 2,
        delivery_info: { exchange: '', routing_key: queue },
        priority: 0,
        body_encoding: 'base64',
        delivery_tag: randomUUID(),
      },
    };

    // kombu's Redis transport pushes with LPUSH and workers consume with
    // BRPOP, so newer messages land at the head of the list. We mirror
    // that to stay protocol-compatible with all existing workers.
    const client = this.redis.getClient();
    await client.lpush(queue, JSON.stringify(envelope));

    this.logger.log(
      `Dispatched Celery task '${taskName}' id=${taskId} queue=${queue}`,
    );
    return taskId;
  }

  /**
   * Cheap Python-ish repr for argsrepr/kwargsrepr headers. The worker
   * only logs these — they are not parsed — so a JSON-shaped string is
   * fine and avoids pulling in a full Python repr port.
   */
  private repr(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return '<unrepresentable>';
    }
  }
}
