import { z } from 'zod';

/**
 * Wire contract of Deep Research (API PR #507, `apps/api/src/modules/deep-research`).
 *
 * Every SSE event and every REST payload is parsed through these schemas before
 * it reaches state. The stream is relayed from rag-service by the gateway, so a
 * frame the client does not understand is DROPPED rather than cast — a
 * half-shaped `result` rendered as if it were whole is the failure mode an
 * unchecked `as` invites.
 *
 * Optional/nullable are applied generously on metadata (court, date, grNo …):
 * those come from the corpus and are legitimately absent on statutes and
 * issuances. The structural fields (ids, sections, claims) are required.
 */

export const DEEP_RESEARCH_STAGES = [
  'planning',
  'searching',
  'ranking',
  'writing',
  'verifying',
] as const;

export const stageSchema = z.enum(DEEP_RESEARCH_STAGES);
export type DeepResearchStage = z.infer<typeof stageSchema>;

const optionalText = z.string().nullish();

export const stageEventSchema = z.object({
  stage: stageSchema,
  detail: optionalText,
});

export const planEventSchema = z.object({
  subQueries: z.array(z.string()),
});

export const sourceSchema = z.object({
  sourceId: z.string(),
  documentId: z.string(),
  sectionId: z.string().nullish(),
  // A statute section can come back untitled; that must not drop the whole list.
  title: z
    .string()
    .nullish()
    .transform((t) => t ?? ''),
  citation: optionalText,
  grNo: optionalText,
  court: optionalText,
  date: optionalText,
  sectionLabel: optionalText,
  documentType: optionalText,
});
export type DeepResearchSource = z.infer<typeof sourceSchema>;

export const sourcesEventSchema = z.object({
  sources: z.array(sourceSchema),
});

export const claimCitationSchema = z.object({
  sourceId: z.string(),
  quote: z.string(),
});
export type ClaimCitation = z.infer<typeof claimCitationSchema>;

export const claimSchema = z.object({
  text: z.string(),
  citations: z.array(claimCitationSchema),
});
export type DeepResearchClaim = z.infer<typeof claimSchema>;

export const sectionSchema = z.object({
  heading: z.string(),
  claims: z.array(claimSchema),
});
export type DeepResearchSection = z.infer<typeof sectionSchema>;

export const resultEventSchema = z.object({
  summary: z.string(),
  sections: z.array(sectionSchema),
  // Contract says a count; tolerate a list of removed statements too, which is
  // what a verifier naturally emits — only its length is ever shown.
  removedClaims: z
    .union([z.number(), z.array(z.unknown())])
    .transform((v) => (Array.isArray(v) ? v.length : v)),
  abstained: z.boolean(),
  abstainReason: optionalText,
});
export type DeepResearchResult = z.infer<typeof resultEventSchema>;

export const doneEventSchema = z.object({
  runId: z.string(),
  modelName: z.string().nullable(),
  promptTemplateVersion: z.string().nullable(),
  latencyMs: z.number(),
  costUsd: z.number(),
});
export type DeepResearchDone = z.infer<typeof doneEventSchema>;

export const DEEP_RESEARCH_ERROR_CODES = [
  'quota_exceeded',
  'subscription_required',
  'budget_exhausted',
  'internal',
] as const;
export type DeepResearchErrorCode = (typeof DEEP_RESEARCH_ERROR_CODES)[number];

export const errorEventSchema = z.object({
  // Anything outside the vocabulary is treated as `internal`, never dropped:
  // an error the client cannot classify must still end the run.
  code: z
    .string()
    .transform((c): DeepResearchErrorCode =>
      (DEEP_RESEARCH_ERROR_CODES as readonly string[]).includes(c)
        ? (c as DeepResearchErrorCode)
        : 'internal',
    ),
  message: z.string().optional().default(''),
  /** Only on a 429 refusal: when the monthly counter resets. */
  resetAt: z.string().optional(),
});

/** One parsed, validated SSE event. */
export type DeepResearchEvent =
  | { type: 'stage'; data: z.infer<typeof stageEventSchema> }
  | { type: 'plan'; data: z.infer<typeof planEventSchema> }
  | { type: 'sources'; data: z.infer<typeof sourcesEventSchema> }
  | { type: 'result'; data: DeepResearchResult }
  | { type: 'done'; data: DeepResearchDone }
  | { type: 'error'; data: z.infer<typeof errorEventSchema> };

const EVENT_SCHEMAS = {
  stage: stageEventSchema,
  plan: planEventSchema,
  sources: sourcesEventSchema,
  result: resultEventSchema,
  done: doneEventSchema,
  error: errorEventSchema,
} as const;

/**
 * Validate one SSE frame. Returns null for an unknown event name, malformed
 * JSON, or a payload that fails its schema.
 */
export function parseDeepResearchEvent(event: string, data: string): DeepResearchEvent | null {
  if (!(event in EVENT_SCHEMAS)) return null;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const type = event as keyof typeof EVENT_SCHEMAS;
  const parsed = EVENT_SCHEMAS[type].safeParse(json);
  if (!parsed.success) return null;
  return { type, data: parsed.data } as DeepResearchEvent;
}

// ─── REST ──────────────────────────────────────────────────

export const RUN_STATUSES = ['running', 'completed', 'abstained', 'failed'] as const;
export type DeepResearchRunStatus = (typeof RUN_STATUSES)[number];

const statusSchema = z
  .string()
  .transform((s): DeepResearchRunStatus =>
    (RUN_STATUSES as readonly string[]).includes(s) ? (s as DeepResearchRunStatus) : 'failed',
  );

/** `GET /deep-research` row: the light projection, no JSON payloads. */
export const runListItemSchema = z.object({
  id: z.string(),
  question: z.string(),
  status: statusSchema,
  modelName: z.string().nullish(),
  createdAt: z.string(),
  latencyMs: z.number().nullish(),
  costUsd: z.number().nullish(),
});
export type DeepResearchRunListItem = z.infer<typeof runListItemSchema>;

export const runListPageSchema = z.object({
  items: z.array(runListItemSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type DeepResearchRunListPage = z.infer<typeof runListPageSchema>;

/**
 * `GET /deep-research/:id`: the whole row. The JSON columns are what the stream
 * carried, persisted verbatim, so they reuse the event schemas — and each is
 * parsed leniently (`.catch(null)`), because a run that failed before `result`
 * has none and must still open.
 */
export const runDetailSchema = z.object({
  id: z.string(),
  question: z.string(),
  status: statusSchema,
  createdAt: z.string(),
  modelName: z.string().nullish(),
  latencyMs: z.number().nullish(),
  resultJson: resultEventSchema.nullish().catch(null),
  sourcesJson: z.array(sourceSchema).nullish().catch(null),
  subQueriesJson: z.array(z.string()).nullish().catch(null),
});
export type DeepResearchRunDetail = z.infer<typeof runDetailSchema>;
