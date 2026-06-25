/**
 * Bulk audio pre-generation — metered, idempotent, budget-capped.
 *
 * Pre-synthesizes audio renditions for the high-value first slice of the corpus
 * (bar-exam answers first, then approved public digests) by driving the EXISTING
 * production synthesis path — {@link AudioRenditionService.generate} — with a hard
 * monthly billed-character cap so a run stays inside Amazon Polly's free tier ($0).
 *
 * Why this is safe + cheap:
 *   - It reuses `AudioRenditionService.generate()` verbatim: the same content-hash
 *     short-circuit, the same Polly call, the same S3 upload + `audio_renditions`
 *     upsert. No synthesis logic is re-implemented here.
 *   - Polly bills audio and speech marks separately at the same per-character rate,
 *     and `generate()` produces BOTH, so the billed cost of one item is
 *     `2 * normalizedText.length` (SSML tags are not billed).
 *   - Polly's synchronous SynthesizeSpeech caps a request at 3,000 billed chars and
 *     6,000 total chars (incl. tags). Items over either limit are skipped and
 *     deferred to a future chunking pass — never silently truncated.
 *   - The `spent + cost > budget` ceiling is checked BEFORE every synth, so a run
 *     can never overshoot the cap. Synthesis is sequential (concurrency 1) so the
 *     metering is exact.
 *   - Fully idempotent: a ready rendition with the same content hash is skipped
 *     (no Polly call, no budget consumed), so the script can be re-run any number
 *     of times and resumes where the cap stopped it.
 *
 * Run commands (from repo root):
 *   # Dry-run plan (default; zero Polly/AWS calls — just prints what it WOULD do)
 *   pnpm --filter @libertasian/api exec tsx scripts/bulk-pregenerate-audio.ts
 *
 *   # Commit, free-tier cap (~186 digests/run after the 53 bar answers)
 *   pnpm --filter @libertasian/api exec tsx scripts/bulk-pregenerate-audio.ts \
 *     --commit --char-budget=900000
 *
 *   # Other flags:
 *   #   --order=cheapest|oldest   digest ordering (default: cheapest)
 *   #   --limit=<n>               cap on items considered (debugging)
 *   #   --skip-report=<path>      write deferred-too-long items as JSON
 *
 * The decision logic (skip-long / already-done / budget-stop / cost = 2×len) is
 * factored into the pure {@link decideItem} helper and unit-tested in
 * `bulk-pregenerate-audio.spec.ts`. The Nest-bootstrap glue below is not unit-tested.
 */
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';

import { toSsmlDocument } from '../src/modules/audio/legal-ssml.util';
import type { AudioContentType } from '../src/modules/audio/audio.types';

// ---------------------------------------------------------------------------
// Pure, testable core — no Nest, no I/O, no AWS.
// ---------------------------------------------------------------------------

/** Polly sync SynthesizeSpeech billed-character limit (normalizedText length). */
export const MAX_BILLED_CHARS = 3000;
/** Polly sync SynthesizeSpeech total-character limit, including SSML tags. */
export const MAX_TOTAL_CHARS = 6000;
/** Default monthly billed-char ceiling for one run (Polly free tier headroom). */
export const DEFAULT_CHAR_BUDGET = 900_000;

/**
 * Billed characters for one item. Polly meters the audio stream and the speech
 * marks stream separately at the same rate, and `generate()` produces both, so a
 * single item costs twice its normalized (spoken) length. SSML tags are free.
 */
export function billedChars(normalizedLength: number): number {
  return 2 * normalizedLength;
}

/** Outcome of the per-item decision, computed before any Polly call. */
export type ItemDecision =
  | { action: 'skip_long'; reason: string }
  | { action: 'already_done' }
  | { action: 'budget_stop'; cost: number }
  | { action: 'synthesize'; cost: number };

export interface DecideItemInput {
  /** `normalizedText.length` — the billed dimension and the 3,000 limit. */
  readonly normalizedLength: number;
  /** `ssml.length` — the total-chars dimension and the 6,000 limit. */
  readonly ssmlLength: number;
  /** True if a ready rendition with this content hash already exists. */
  readonly alreadyDone: boolean;
  /** Billed chars already consumed this run. */
  readonly spent: number;
  /** Hard billed-char ceiling for this run. */
  readonly budget: number;
}

/**
 * Decide what to do with one item, in the mandated order:
 *   1. skip-long — over either Polly limit → defer, consumes no budget;
 *   2. already-done — a ready rendition already exists → skip, no budget;
 *   3. budget — `spent + cost > budget` → STOP the run cleanly (caller breaks);
 *   4. otherwise synthesize, at `cost = 2 * normalizedLength`.
 *
 * Pure: no DB call. The caller supplies `alreadyDone` (mirroring `generate()`'s
 * `findFirst({ contentHash, voiceId, language, status: 'ready' })`) and the
 * running `spent` tally.
 */
export function decideItem(input: DecideItemInput): ItemDecision {
  const { normalizedLength, ssmlLength, alreadyDone, spent, budget } = input;

  if (normalizedLength > MAX_BILLED_CHARS || ssmlLength > MAX_TOTAL_CHARS) {
    return {
      action: 'skip_long',
      reason: `normalizedText=${normalizedLength} (max ${MAX_BILLED_CHARS}), ssml=${ssmlLength} (max ${MAX_TOTAL_CHARS})`,
    };
  }

  if (alreadyDone) {
    return { action: 'already_done' };
  }

  const cost = billedChars(normalizedLength);
  if (spent + cost > budget) {
    return { action: 'budget_stop', cost };
  }

  return { action: 'synthesize', cost };
}

/** Parsed CLI options. */
export interface RunOptions {
  readonly commit: boolean;
  readonly charBudget: number;
  readonly order: 'cheapest' | 'oldest';
  readonly limit?: number;
  readonly skipReport?: string;
}

/** Parse argv (already sliced past `node script.ts`). Throws on bad input. */
export function parseArgs(argv: readonly string[]): RunOptions {
  let commit = false;
  let charBudget = DEFAULT_CHAR_BUDGET;
  let order: 'cheapest' | 'oldest' = 'cheapest';
  let limit: number | undefined;
  let skipReport: string | undefined;

  const numFlag = (raw: string, name: string): number => {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
    }
    return value;
  };

  for (const arg of argv) {
    if (arg === '--commit') {
      commit = true;
    } else if (arg.startsWith('--char-budget=')) {
      charBudget = numFlag(arg.slice('--char-budget='.length), '--char-budget');
    } else if (arg.startsWith('--order=')) {
      const value = arg.slice('--order='.length);
      if (value !== 'cheapest' && value !== 'oldest') {
        throw new Error(`--order must be cheapest|oldest, got "${value}"`);
      }
      order = value;
    } else if (arg.startsWith('--limit=')) {
      limit = numFlag(arg.slice('--limit='.length), '--limit');
    } else if (arg.startsWith('--skip-report=')) {
      skipReport = arg.slice('--skip-report='.length);
      if (skipReport.length === 0) {
        throw new Error('--skip-report requires a path');
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { commit, charBudget, order, limit, skipReport };
}

// ---------------------------------------------------------------------------
// Orchestration — Nest bootstrap + worklist + metered loop. Not unit-tested.
// ---------------------------------------------------------------------------

/** A candidate item resolved to its spoken form (no AWS calls made yet). */
interface ResolvedItem {
  readonly contentType: AudioContentType;
  readonly contentId: string;
  readonly createdAt: Date;
  readonly normalizedText: string;
  readonly ssml: string;
  readonly contentHash: string;
}

/** Deferred (too-long) item, as written to the --skip-report file. */
interface DeferredItem {
  readonly id: string;
  readonly type: AudioContentType;
  readonly normalizedLength: number;
  readonly ssmlLength: number;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // Dynamic imports keep the Nest/Prisma graph out of module-load so the pure
  // helpers above can be imported by the spec without bootstrapping the app.
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module');
  const { AudioRenditionService } = await import(
    '../src/modules/audio/audio-rendition.service'
  );
  const { PrismaService } = await import('../src/prisma/prisma.service');

  const language = 'en';

  console.log('=== Bulk audio pre-generation ===');
  console.log(`Mode:           ${opts.commit ? 'COMMIT (synthesizes via Polly)' : 'DRY RUN (no AWS calls)'}`);
  console.log(`Char budget:    ${opts.charBudget.toLocaleString()} billed chars`);
  console.log(`Digest order:   ${opts.order}`);
  console.log(`Limit:          ${opts.limit ?? '(none)'}`);
  console.log(`AWS_REGION:     ${process.env.AWS_REGION ?? '(unset)'}`);
  console.log(`POLLY_VOICE_ID: ${process.env.POLLY_VOICE_ID ?? 'Matthew (default)'}`);
  console.log(`POLLY_ENGINE:   ${process.env.POLLY_ENGINE ?? 'neural (default)'}`);
  console.log(`POLLY_NEWSCASTER: ${process.env.POLLY_NEWSCASTER ?? '(unset)'}`);
  console.log('');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const service = app.get(AudioRenditionService);
    const prisma = app.get(PrismaService);
    const voiceId = service.voiceId;

    // --- Build the candidate set: bar answers (priority) then digests. ------
    const barRows = await prisma.barExamAnswer.findMany({
      where: { reviewStatus: 'approved' },
      select: { id: true, createdAt: true },
      orderBy: { id: 'asc' },
    });
    const digestRows = await prisma.digest.findMany({
      where: { reviewStatus: 'approved', visibility: 'public_editorial' },
      select: { id: true, createdAt: true },
      orderBy: { id: 'asc' },
    });
    const digestTotal = digestRows.length;
    console.log(
      `Candidates: ${barRows.length} approved bar answers, ${digestTotal} approved public digests.`,
    );

    // Resolve each candidate to its spoken form + hash. Pure DB + CPU; no AWS.
    // A resolve failure drops the single item (logged) rather than aborting.
    const resolve = async (
      contentType: AudioContentType,
      id: string,
      createdAt: Date,
    ): Promise<ResolvedItem | null> => {
      try {
        const { doc } = await service.resolveText(contentType, id);
        const { ssml, normalizedText } = toSsmlDocument(doc);
        const contentHash = createHash('sha256')
          .update(normalizedText)
          .digest('hex');
        return { contentType, contentId: id, createdAt, normalizedText, ssml, contentHash };
      } catch (err) {
        console.error(`  resolve failed ${contentType}:${id}: ${(err as Error).message}`);
        return null;
      }
    };

    const barItems: ResolvedItem[] = [];
    for (const row of barRows) {
      const item = await resolve('bar_exam_answer', row.id, row.createdAt);
      if (item) barItems.push(item);
    }

    const digestItems: ResolvedItem[] = [];
    for (const row of digestRows) {
      const item = await resolve('digest', row.id, row.createdAt);
      if (item) digestItems.push(item);
    }

    // Order digests per --order; deterministic id tiebreak so a capped run is
    // reproducible. cheapest → most items fit under the cap; stop-at-first-over
    // is then optimal (nothing cheaper remains downstream).
    digestItems.sort((a, b) => {
      const primary =
        opts.order === 'cheapest'
          ? a.normalizedText.length - b.normalizedText.length
          : a.createdAt.getTime() - b.createdAt.getTime();
      return primary !== 0 ? primary : a.contentId.localeCompare(b.contentId);
    });

    let worklist: ResolvedItem[] = [...barItems, ...digestItems];
    if (opts.limit !== undefined) {
      worklist = worklist.slice(0, opts.limit);
    }

    // --- Metered, sequential decision + synthesis loop. ---------------------
    let spent = 0;
    let processed = 0; // synthesized (commit) / would-synthesize (dry-run)
    let alreadyDoneCount = 0;
    let failures = 0;
    let barCompleted = 0;
    let digestCompleted = 0;
    const deferred: DeferredItem[] = [];
    let stopped = false;
    let remainingAtStop = 0;

    const markCompleted = (type: AudioContentType): void => {
      if (type === 'digest') digestCompleted += 1;
      else barCompleted += 1;
    };

    for (let i = 0; i < worklist.length; i += 1) {
      const item = worklist[i]!;
      const normalizedLength = item.normalizedText.length;
      const ssmlLength = item.ssml.length;

      // Avoid a DB round-trip for oversized items, which are deferred regardless.
      const tooLong =
        normalizedLength > MAX_BILLED_CHARS || ssmlLength > MAX_TOTAL_CHARS;
      const alreadyDone = tooLong
        ? false
        : (await prisma.audioRendition.findFirst({
            where: { contentHash: item.contentHash, voiceId, language, status: 'ready' },
            select: { id: true },
          })) !== null;

      const decision = decideItem({
        normalizedLength,
        ssmlLength,
        alreadyDone,
        spent,
        budget: opts.charBudget,
      });

      if (decision.action === 'skip_long') {
        deferred.push({
          id: item.contentId,
          type: item.contentType,
          normalizedLength,
          ssmlLength,
        });
        console.log(`  SKIP (too long) ${item.contentType}:${item.contentId} — ${decision.reason}`);
        continue;
      }

      if (decision.action === 'already_done') {
        alreadyDoneCount += 1;
        markCompleted(item.contentType);
        continue;
      }

      if (decision.action === 'budget_stop') {
        stopped = true;
        remainingAtStop = worklist.length - i;
        console.log(
          `  BUDGET STOP at ${item.contentType}:${item.contentId} — next item costs ${decision.cost}, only ${opts.charBudget - spent} left. ${remainingAtStop} item(s) not processed this run.`,
        );
        break;
      }

      // decision.action === 'synthesize'
      if (opts.commit) {
        try {
          await service.generate({
            contentType: item.contentType,
            contentId: item.contentId,
            language,
          });
          spent += decision.cost;
          processed += 1;
          markCompleted(item.contentType);
          console.log(
            `  OK ${item.contentType}:${item.contentId} (+${decision.cost} billed, ${spent}/${opts.charBudget} spent)`,
          );
        } catch (err) {
          failures += 1;
          console.error(`  FAIL ${item.contentType}:${item.contentId}: ${(err as Error).message}`);
        }
      } else {
        spent += decision.cost;
        processed += 1;
        markCompleted(item.contentType);
        console.log(
          `  would synth ${item.contentType}:${item.contentId} (+${decision.cost} billed, ${spent}/${opts.charBudget})`,
        );
      }
    }

    // --- Summary (both modes). ---------------------------------------------
    const verb = opts.commit ? 'Synthesized' : 'Would synthesize';
    console.log('');
    console.log('=== Summary ===');
    console.log(`Mode:                 ${opts.commit ? 'COMMIT' : 'DRY RUN'}`);
    console.log(`${verb}:        ${processed}`);
    console.log(`  bar answers done:   ${barCompleted}`);
    console.log(`  digests done:       ${digestCompleted}`);
    console.log(`Billed chars spent:   ${spent.toLocaleString()} / ${opts.charBudget.toLocaleString()} (remaining ${(opts.charBudget - spent).toLocaleString()})`);
    console.log(`Skipped (too long):   ${deferred.length}`);
    console.log(`Already done (skip):  ${alreadyDoneCount}`);
    console.log(`Failures:             ${failures}`);
    if (stopped) {
      console.log(`Stopped early on budget: yes (${remainingAtStop} item(s) not processed)`);
    }

    const digestRemaining = digestTotal - digestCompleted;
    console.log(
      `${digestRemaining} of ${digestTotal} approved digests remain — re-run next month to continue (free).`,
    );

    if (opts.skipReport) {
      writeFileSync(opts.skipReport, `${JSON.stringify(deferred, null, 2)}\n`);
      console.log(`Wrote skip report: ${opts.skipReport} (${deferred.length} item(s))`);
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
