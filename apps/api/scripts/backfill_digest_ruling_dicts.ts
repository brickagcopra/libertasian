/**
 * One-shot backfill for digests whose ruling (or other narrative fields)
 * was persisted as a stringified Python dict literal.
 *
 * Context: 7,541 of 10,923 digests on prod render the ruling field as raw
 * dict syntax — e.g. ``"{'issue_1': '...', 'issue_2': '...'}"`` — because
 * an older version of services/rag-service/src/digests/service.py
 * ``_coerce_text`` had a ``str(value)`` fallback that stringified dicts
 * returned by the LLM. The writer is fixed in this PR; this script
 * back-fills the affected rows.
 *
 * Usage (run from repo root, NOT from CI):
 *   # Dry run — preview the first 3 transformations only
 *   pnpm --filter @libertasian/api exec tsx scripts/backfill_digest_ruling_dicts.ts --dry-run
 *
 *   # Commit changes (default batch=100; raise carefully)
 *   pnpm --filter @libertasian/api exec tsx scripts/backfill_digest_ruling_dicts.ts --commit --batch=100
 *
 *   # Cap the total number of rows processed (debugging / canary):
 *   pnpm --filter @libertasian/api exec tsx scripts/backfill_digest_ruling_dicts.ts --commit --limit=500
 *
 * Idempotent: rows whose ruling no longer matches the dict-shape pattern
 * are skipped. Safe to re-run.
 */
import { PrismaClient } from '@prisma/client';

type Args = {
  dryRun: boolean;
  commit: boolean;
  batch: number;
  limit: number | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: true, commit: false, batch: 100, limit: null };
  for (const arg of argv) {
    if (arg === '--dry-run') {
      args.dryRun = true;
      args.commit = false;
    } else if (arg === '--commit') {
      args.commit = true;
      args.dryRun = false;
    } else if (arg.startsWith('--batch=')) {
      const n = Number(arg.slice('--batch='.length));
      if (Number.isFinite(n) && n > 0) args.batch = Math.floor(n);
    } else if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length));
      if (Number.isFinite(n) && n > 0) args.limit = Math.floor(n);
    }
  }
  return args;
}

const DICT_PATTERN = /^\s*\{\s*['"]/;

/**
 * Parse a stringified Python dict literal into a JS object.
 *
 * Handles the common cases the LLM produces:
 *  - ``{'key': 'value', 'key2': 'value2'}``  (single-quoted Python literal)
 *  - ``{"key": "value"}``                     (already valid JSON)
 *
 * Returns null on parse failure so the caller can skip the row.
 */
function parsePythonDictLiteral(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!DICT_PATTERN.test(trimmed)) return null;

  // Fast path: already valid JSON.
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // fall through to the single-quoted path
  }

  // Convert single-quoted Python literal → JSON.
  // This is conservative: we only swap quote characters that are NOT
  // escaped and NOT inside an already-double-quoted span. For the LLM
  // outputs we've sampled the dicts are flat (str -> str) so the simple
  // swap is sufficient. If parsing fails we drop the row.
  let inSingle = false;
  let inDouble = false;
  let out = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    const prev = i > 0 ? trimmed[i - 1] : '';
    if (ch === '"' && !inSingle && prev !== '\\') {
      inDouble = !inDouble;
      out += '"';
    } else if (ch === "'" && !inDouble && prev !== '\\') {
      inSingle = !inSingle;
      out += '"';
    } else if (ch === '"' && inSingle) {
      // Embedded double-quote inside a single-quoted string → escape it.
      out += '\\"';
    } else {
      out += ch;
    }
  }
  // Python None/True/False → JSON null/true/false (rare but cheap).
  out = out
    .replace(/\bNone\b/g, 'null')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false');

  try {
    const parsed = JSON.parse(out);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function flattenDictValues(dict: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const v of Object.values(dict)) {
    if (v == null) continue;
    const text = String(v).trim();
    if (text) parts.push(text);
  }
  if (parts.length === 0) return null;
  return parts.join('\n\n');
}

/**
 * Mirror of services/rag-service/src/digests/service.py _coerce_text for
 * the string-input case: if it looks like a Python dict literal, parse
 * and flatten; otherwise return the original string.
 */
function coerceRuling(raw: string): string | null {
  const flattened = (() => {
    const dict = parsePythonDictLiteral(raw);
    if (!dict) return null;
    return flattenDictValues(dict);
  })();
  return flattened;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[backfill_digest_ruling_dicts] args=${JSON.stringify(args)}`);

  const prisma = new PrismaClient();
  try {
    const totalMatching = await prisma.digest.count({
      where: { ruling: { startsWith: '{' } },
    });
    console.log(`Digests with ruling starting with '{': ${totalMatching}`);

    let processed = 0;
    let updated = 0;
    let skippedUnparseable = 0;
    let skippedNotDict = 0;
    let previewShown = 0;

    while (true) {
      if (args.limit !== null && processed >= args.limit) break;

      const remaining = args.limit !== null ? args.limit - processed : undefined;
      const take = remaining !== undefined ? Math.min(args.batch, remaining) : args.batch;

      const rows = await prisma.digest.findMany({
        where: { ruling: { startsWith: '{' } },
        select: { id: true, ruling: true },
        take,
        skip: args.dryRun ? processed : 0,
        orderBy: { createdAt: 'asc' },
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        processed++;
        if (!row.ruling) continue;
        if (!DICT_PATTERN.test(row.ruling)) {
          skippedNotDict++;
          continue;
        }
        const fixed = coerceRuling(row.ruling);
        if (fixed === null) {
          skippedUnparseable++;
          continue;
        }
        if (fixed === row.ruling) {
          skippedNotDict++;
          continue;
        }
        if (previewShown < 3) {
          previewShown++;
          console.log(`\n--- preview ${previewShown} (id=${row.id}) ---`);
          console.log(`before: ${row.ruling.slice(0, 200)}${row.ruling.length > 200 ? '…' : ''}`);
          console.log(`after:  ${fixed.slice(0, 200)}${fixed.length > 200 ? '…' : ''}`);
        }
        if (args.commit) {
          await prisma.digest.update({
            where: { id: row.id },
            data: { ruling: fixed },
          });
        }
        updated++;
      }

      console.log(
        `[batch] processed=${processed} updated=${updated} skipped_unparseable=${skippedUnparseable} skipped_not_dict=${skippedNotDict}`,
      );

      // For commit mode, the next iteration's findMany re-issues the same
      // WHERE — the just-updated rows no longer match, so a new batch is
      // available without a cursor. For dry-run we keep skipping ahead.
      if (rows.length < take) break;
    }

    console.log(
      `\n[done] processed=${processed} ${args.commit ? 'updated' : 'would_update'}=${updated} skipped_unparseable=${skippedUnparseable} skipped_not_dict=${skippedNotDict}`,
    );
    if (!args.commit) {
      console.log('Dry run only. Re-run with --commit to apply changes.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
