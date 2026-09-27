import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import { costForUsd } from '../../common/constants/model-pricing';
import { PrismaService } from '../../prisma/prisma.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import type { DeepResearchStreamDto, ListDeepResearchQueryDto } from './dto';
import { formatSseFrame, SseFrameParser, type SseFrame } from './sse-frame-parser';

/** Budget category every Deep Research call is charged to (BUDGET_SCOPES). */
export const DEEP_RESEARCH_SCOPE = 'ai_research';

/** The quota unit one Deep Research run consumes. */
export const DEEP_RESEARCH_QUOTA = 'deepResearchPerMonth' as const;

export type DeepResearchStatus = 'running' | 'completed' | 'abstained' | 'failed';

/** SSE `error.code` vocabulary of the client contract. */
export type DeepResearchErrorCode =
  | 'quota_exceeded'
  | 'subscription_required'
  | 'budget_exhausted'
  | 'internal';

/** Events forwarded to the client verbatim. `done` is rewritten; the rest dropped. */
const FORWARDED_EVENTS = new Set(['stage', 'plan', 'sources', 'result', 'error']);

/** rag-service 503 `code`s that mean "AI spend is exhausted", not "broken". */
const BUDGET_UPSTREAM_CODES = new Set(['budget_exceeded', 'provider_quota_exhausted']);

export interface RelayContext {
  runId: string;
  organizationId: string;
  userId: string;
  isPlatformAdmin: boolean;
  dto: DeepResearchStreamDto;
  /** When the run started, for the end-to-end latency reported in `done`. */
  startedAt: number;
  /** Writes one serialized frame to the client. Must be a no-op once it left. */
  write: (frame: string) => void;
}

export interface RelayOutcome {
  status: Exclude<DeepResearchStatus, 'running'>;
  errorCode?: DeepResearchErrorCode;
  refunded: boolean;
}

interface RelayState {
  result?: Record<string, unknown>;
  sources?: unknown;
  subQueries?: unknown;
  done?: Record<string, unknown>;
  errorCode?: DeepResearchErrorCode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function int(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
}

/** Light projection for the history list: no JSON payloads. */
const LIST_SELECT = {
  id: true,
  question: true,
  status: true,
  modelName: true,
  createdAt: true,
  latencyMs: true,
  costUsd: true,
} as const;

@Injectable()
export class DeepResearchService {
  private readonly logger = new Logger(DeepResearchService.name);
  private readonly ragServiceUrl: string;
  private readonly internalApiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly usageQuota: UsageQuotaService,
  ) {
    this.ragServiceUrl = this.config.get<string>('RAG_SERVICE_URL', 'http://localhost:8000');
    this.internalApiKey = this.config.get<string>('INTERNAL_API_KEY', '');
  }

  // ---- persistence -------------------------------------------------------

  /** Create the `running` row BEFORE rag is called; its id is the run_id. */
  async createRun(organizationId: string, userId: string, question: string) {
    return this.prisma.forTenant(organizationId).deepResearchRun.create({
      data: { organizationId, userId, question, status: 'running' },
      select: { id: true, createdAt: true },
    });
  }

  /** Mark a run failed without a stream (e.g. we never reached rag). */
  async markFailed(organizationId: string, runId: string): Promise<void> {
    await this.prisma
      .forTenant(organizationId)
      .deepResearchRun.update({ where: { id: runId }, data: { status: 'failed' } })
      .catch((err: unknown) =>
        this.logger.warn(`Failed to mark deep research run failed: ${(err as Error).message}`),
      );
  }

  /** The caller's OWN runs, newest first, keyset-paginated. */
  async list(organizationId: string, userId: string, query: ListDeepResearchQueryDto) {
    const limit = query.limit ?? 20;
    const rows = await this.prisma.forTenant(organizationId).deepResearchRun.findMany({
      where: { userId },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: LIST_SELECT,
    });
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
      ...row,
      costUsd: row.costUsd === null ? null : Number(row.costUsd),
    }));
    return {
      items,
      meta: { nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null, hasMore },
    };
  }

  /**
   * One of the caller's own runs. Another user's run — same org or not — is a
   * 404, never a 403: the id's existence is not the caller's business.
   */
  async findById(organizationId: string, userId: string, id: string) {
    const row = await this.prisma
      .forTenant(organizationId)
      .deepResearchRun.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Deep research run not found');
    return { ...row, costUsd: row.costUsd === null ? null : Number(row.costUsd) };
  }

  async delete(organizationId: string, userId: string, id: string): Promise<void> {
    const { count } = await this.prisma
      .forTenant(organizationId)
      .deepResearchRun.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Deep research run not found');
  }

  // ---- upstream relay ----------------------------------------------------

  /**
   * Proxy rag-service's POST /research/deep stream to the client, then persist.
   *
   * The upstream is read to the END even when the client has gone: the unit is
   * already spent and the LLM calls are already running, so the run is saved
   * (and visible in history) either way. `ctx.write` is what goes quiet, not
   * this loop.
   *
   * `done` is held back until the row is persisted, so a client that fetches
   * `GET /deep-research/:runId` on receiving it never sees `running`.
   */
  async relay(ctx: RelayContext): Promise<RelayOutcome> {
    const state: RelayState = {};
    const emitError = (code: DeepResearchErrorCode, message: string) => {
      if (state.errorCode) return; // one terminal error per stream
      state.errorCode = code;
      ctx.write(formatSseFrame('error', { code, message }));
    };

    try {
      const upstream = await fetch(`${this.ragServiceUrl}/research/deep`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(this.internalApiKey && { 'X-Internal-Api-Key': this.internalApiKey }),
        },
        body: JSON.stringify({
          question: ctx.dto.question,
          run_id: ctx.runId,
          model_override: ctx.dto.modelOverride ?? null,
          scope: DEEP_RESEARCH_SCOPE,
        }),
      });

      if (!upstream.ok) {
        const code = await this.classifyUpstreamFailure(upstream);
        emitError(
          code,
          code === 'budget_exhausted'
            ? 'Deep Research is temporarily unavailable. Please try again later.'
            : 'Deep Research failed. Please try again.',
        );
      } else if (!upstream.body) {
        emitError('internal', 'Deep Research failed. Please try again.');
      } else {
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        const parser = new SseFrameParser();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
            this.handleFrame(frame, state, ctx, emitError);
          }
        }
        for (const frame of parser.push(decoder.decode())) {
          this.handleFrame(frame, state, ctx, emitError);
        }
        for (const frame of parser.flush()) {
          this.handleFrame(frame, state, ctx, emitError);
        }
      }
    } catch (err) {
      this.logger.error(`Deep research stream proxy error: ${(err as Error).message}`);
      emitError('internal', 'Deep Research was interrupted. Please try again.');
    }

    if (!state.errorCode && (!state.done || !state.result)) {
      emitError('internal', 'Deep Research ended unexpectedly. Please try again.');
    }

    const status: RelayOutcome['status'] = state.errorCode
      ? 'failed'
      : state.result?.['abstained'] === true
        ? 'abstained'
        : 'completed';

    const refunded = await this.finalize(ctx, state, status);

    if (status !== 'failed' && state.done) {
      ctx.write(formatSseFrame('done', this.clientDone(ctx, state.done)));
    }
    return { status, errorCode: state.errorCode, refunded };
  }

  private handleFrame(
    frame: SseFrame,
    state: RelayState,
    ctx: RelayContext,
    emitError: (code: DeepResearchErrorCode, message: string) => void,
  ): void {
    let payload: unknown;
    try {
      payload = JSON.parse(frame.data);
    } catch {
      this.logger.warn(`Dropping unparseable deep research frame (event=${frame.event})`);
      return;
    }
    if (!isRecord(payload)) return;

    switch (frame.event) {
      case 'done':
        state.done = payload;
        return; // written after persistence, rewritten to the contract
      case 'error': {
        const code: DeepResearchErrorCode =
          payload['code'] === 'budget_exhausted' ? 'budget_exhausted' : 'internal';
        emitError(code, str(payload['message']) ?? 'Deep Research failed. Please try again.');
        return;
      }
      case 'plan':
        state.subQueries = payload['subQueries'];
        break;
      case 'sources':
        state.sources = payload['sources'];
        break;
      case 'result':
        state.result = payload;
        break;
      default:
        break;
    }
    if (FORWARDED_EVENTS.has(frame.event)) {
      ctx.write(formatSseFrame(frame.event, payload));
    }
  }

  /** Exactly the five contract fields. tokens / modelVersion stay server-side. */
  private clientDone(ctx: RelayContext, done: Record<string, unknown>) {
    return {
      runId: ctx.runId,
      modelName: str(done['modelName']) ?? null,
      promptTemplateVersion: str(done['promptTemplateVersion']) ?? null,
      // End-to-end as the API measured it (run creation → persisted), which is
      // what the user waited — rag's own figure excludes the gateway hop.
      latencyMs: Date.now() - ctx.startedAt,
      costUsd: this.costOf(done),
    };
  }

  private costOf(done: Record<string, unknown>): number {
    const reported = done['costUsd'];
    if (typeof reported === 'number' && Number.isFinite(reported)) return reported;
    return costForUsd(
      str(done['modelName']),
      int(done['tokensIn']) ?? 0,
      int(done['tokensOut']) ?? 0,
    );
  }

  private async classifyUpstreamFailure(upstream: Response): Promise<DeepResearchErrorCode> {
    const text = await upstream.text().catch(() => '');
    this.logger.error(`RAG deep research error: HTTP ${upstream.status}`);
    if (upstream.status !== 503) return 'internal';
    try {
      const body: unknown = JSON.parse(text);
      if (isRecord(body) && typeof body['code'] === 'string' && BUDGET_UPSTREAM_CODES.has(body['code'])) {
        return 'budget_exhausted';
      }
    } catch {
      // non-JSON 503 body: treat as a generic failure
    }
    return 'internal';
  }

  /**
   * Persist the outcome, give the quota unit back when the user got nothing
   * (abstained / failed / budget exhausted), and record model_runs +
   * budget_ledger. Never throws: every step logs and carries on, because the
   * client is still owed its terminal event.
   */
  private async finalize(
    ctx: RelayContext,
    state: RelayState,
    status: RelayOutcome['status'],
  ): Promise<boolean> {
    const done = state.done;
    const latencyMs = Date.now() - ctx.startedAt;
    const modelName = done ? str(done['modelName']) : undefined;
    const tokensIn = done ? int(done['tokensIn']) : undefined;
    const tokensOut = done ? int(done['tokensOut']) : undefined;
    const costUsd = done ? this.costOf(done) : undefined;
    const promptTemplateVersion = done ? str(done['promptTemplateVersion']) : undefined;

    await this.prisma
      .forTenant(ctx.organizationId)
      .deepResearchRun.update({
        where: { id: ctx.runId },
        data: {
          status,
          ...(state.result !== undefined && { resultJson: state.result as Prisma.InputJsonValue }),
          ...(state.sources !== undefined && { sourcesJson: state.sources as Prisma.InputJsonValue }),
          ...(state.subQueries !== undefined && {
            subQueriesJson: state.subQueries as Prisma.InputJsonValue,
          }),
          ...(modelName !== undefined && { modelName }),
          ...(promptTemplateVersion !== undefined && { promptTemplateVersion }),
          ...(tokensIn !== undefined && { tokensIn }),
          ...(tokensOut !== undefined && { tokensOut }),
          ...(costUsd !== undefined && { costUsd }),
          latencyMs,
        },
      })
      .catch((err: unknown) =>
        this.logger.error(`Failed to persist deep research run: ${(err as Error).message}`),
      );

    let refunded = false;
    if (status !== 'completed') {
      refunded = await this.usageQuota.refund(
        ctx.organizationId,
        ctx.userId,
        DEEP_RESEARCH_QUOTA,
        { isPlatformAdmin: ctx.isPlatformAdmin },
      );
    }

    if (done) {
      // Non-blocking, like ai-answers: accounting must never lose a result.
      this.prisma.modelRun
        .create({
          data: {
            runType: 'deep_research',
            modelName: modelName ?? 'unknown',
            modelVersion: str(done['modelVersion']),
            promptTemplateVersion,
            inputRef: `deep_research_run:${ctx.runId}`,
            outputRef: status,
            tokensIn,
            tokensOut,
            latencyMs,
          },
        })
        .catch((err: unknown) =>
          this.logger.warn(`Failed to record model run: ${(err as Error).message}`),
        );

      if ((tokensIn ?? 0) > 0 || (tokensOut ?? 0) > 0) {
        const now = new Date().toISOString();
        this.prisma.budgetLedger
          .create({
            data: {
              periodYearMonth: now.slice(0, 7),
              periodDay: now.slice(0, 10),
              scope: DEEP_RESEARCH_SCOPE,
              amountUsd: costUsd ?? 0,
              tokensIn: tokensIn ?? 0,
              tokensOut: tokensOut ?? 0,
              modelName,
            },
          })
          .catch((err: unknown) =>
            this.logger.warn(`Failed to record deep research budget ledger entry: ${(err as Error).message}`),
          );
      }
    }

    this.logger.log(
      `Deep research run ${ctx.runId} ${status}` +
        ` (questionLength=${ctx.dto.question.length}, refunded=${refunded}, latencyMs=${latencyMs})`,
    );
    return refunded;
  }
}
