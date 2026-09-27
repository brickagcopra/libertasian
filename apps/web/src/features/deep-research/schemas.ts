/**
 * Zod schemas for everything Deep Research reads off the wire.
 *
 * Mirrors apps/api/src/modules/deep-research (PR #507) and the rag-service
 * payload builders in services/rag-service/src/deep_research/service.py.
 * Metadata that the corpus may lack (court, date, G.R. No., section label)
 * is `nullish`; the fields the UI cannot work without are required.
 */
import { z } from 'zod';

export const STAGES = ['planning', 'searching', 'ranking', 'writing', 'verifying'] as const;
export const stageSchema = z.enum(STAGES);
export type DeepResearchStage = z.infer<typeof stageSchema>;

export const stageEventSchema = z.object({
  stage: stageSchema,
  detail: z.string().nullish(),
});

export const planEventSchema = z.object({
  subQueries: z.array(z.string()),
});

export const sourceSchema = z.object({
  sourceId: z.string().min(1),
  documentId: z.string().min(1),
  sectionId: z.string().nullish(),
  title: z.string(),
  citation: z.string().nullish(),
  grNo: z.string().nullish(),
  court: z.string().nullish(),
  date: z.string().nullish(),
  sectionLabel: z.string().nullish(),
  documentType: z.string().nullish(),
});
export type DeepResearchSource = z.infer<typeof sourceSchema>;

export const sourcesEventSchema = z.object({
  sources: z.array(sourceSchema),
});

export const citationSchema = z.object({
  sourceId: z.string().min(1),
  quote: z.string(),
});
export type DeepResearchCitation = z.infer<typeof citationSchema>;

export const claimSchema = z.object({
  text: z.string(),
  citations: z.array(citationSchema).default([]),
});
export type DeepResearchClaim = z.infer<typeof claimSchema>;

export const sectionSchema = z.object({
  heading: z.string(),
  claims: z.array(claimSchema).default([]),
});

export const resultSchema = z.object({
  summary: z.string(),
  sections: z.array(sectionSchema).default([]),
  removedClaims: z.number().int().nonnegative().default(0),
  abstained: z.boolean().default(false),
  abstainReason: z.string().nullish(),
});
export type DeepResearchResult = z.infer<typeof resultSchema>;

export const doneEventSchema = z.object({
  runId: z.string().min(1),
  modelName: z.string().nullish(),
  promptTemplateVersion: z.string().nullish(),
  latencyMs: z.number().nullish(),
  costUsd: z.number().nullish(),
});
export type DeepResearchDone = z.infer<typeof doneEventSchema>;

export const STREAM_ERROR_CODES = [
  'quota_exceeded',
  'subscription_required',
  'budget_exhausted',
  'internal',
] as const;

export const errorEventSchema = z.object({
  // Unknown codes degrade to `internal` rather than failing the parse: a new
  // server-side code must still end the run with an error card.
  code: z.string().transform((c) =>
    (STREAM_ERROR_CODES as readonly string[]).includes(c)
      ? (c as (typeof STREAM_ERROR_CODES)[number])
      : 'internal',
  ),
  message: z.string().default('Deep Research failed. Please try again.'),
});

// ---- REST ------------------------------------------------------------------

export const runStatusSchema = z.enum(['running', 'completed', 'abstained', 'failed']);
export type DeepResearchRunStatus = z.infer<typeof runStatusSchema>;

/** One row of GET /deep-research (LIST_SELECT on the API: no JSON payloads). */
export const runListItemSchema = z.object({
  id: z.string(),
  question: z.string(),
  status: runStatusSchema,
  modelName: z.string().nullish(),
  createdAt: z.string(),
  latencyMs: z.number().nullish(),
  costUsd: z.number().nullish(),
});
export type DeepResearchRunListItem = z.infer<typeof runListItemSchema>;

/**
 * GET /deep-research body. The controller returns
 * `{ success, data: items[], meta: { nextCursor, hasMore } }` with NO global
 * TransformInterceptor, so `data` IS the array — it is not `data.data`, and
 * the flag is `hasMore`, not the `hasNext` other list endpoints use.
 */
export const runListEnvelopeSchema = z.object({
  data: z.array(runListItemSchema),
  meta: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
});
export type DeepResearchRunPage = {
  items: DeepResearchRunListItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

/** One saved run: the full Prisma row, JSON columns as persisted by finalize(). */
export const runDetailSchema = runListItemSchema.extend({
  resultJson: resultSchema.nullish(),
  // finalize() stores the `sources` ARRAY of the sources event, not the event.
  sourcesJson: z.array(sourceSchema).nullish(),
  subQueriesJson: z.array(z.string()).nullish(),
  promptTemplateVersion: z.string().nullish(),
});
export type DeepResearchRunDetail = z.infer<typeof runDetailSchema>;

/** GET /deep-research/:id body: `{ success, data: run }`. */
export const runDetailEnvelopeSchema = z.object({
  data: runDetailSchema,
});
