import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Guard: no read path may filter subscriptions through the `plan` relation.
 *
 * `subscriptions.plan_code` is authoritative; `plan_id` is a nullable
 * convenience relation. A `where: { plan: { ... } }` silently drops every row
 * whose `plan_id` is still NULL — which was 41 of 57 rows on prod (33 of them
 * active) before the backfill, and can be non-zero again at any time because
 * the write-time link is deliberately best-effort (an unknown plan code writes
 * the row with a NULL plan_id rather than failing the signup).
 *
 * Filter on `planCode`. Use the relation for `include` / `select` only.
 */

const SRC_ROOT = join(__dirname, '..', '..');

/** Prisma operations that read or match rows (as opposed to plain writes). */
const MATCHING_OPS = [
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
  'update',
  'delete',
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.endsWith('.spec.ts') || entry.endsWith('.e2e-spec.ts') || entry.endsWith('.d.ts')) {
      continue;
    }
    out.push(full);
  }
  return out;
}

/** Returns the substring of `source` bounded by the delimiters opening at `openIndex`. */
function readBalanced(source: string, openIndex: number, open: string, close: string): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return source.slice(openIndex);
}

/**
 * Finds `where: { ... }` blocks inside a Prisma call and reports those that
 * constrain the `plan` relation (`plan: {` or `plan: null`).
 */
function findPlanRelationFilters(callBody: string): string[] {
  const offenders: string[] = [];
  const wherePattern = /\bwhere\s*:\s*\{/g;
  let match = wherePattern.exec(callBody);
  while (match !== null) {
    const block = readBalanced(callBody, match.index + match[0].length - 1, '{', '}');
    if (/\bplan\s*:\s*(\{|null)/.test(block)) {
      offenders.push(block.replace(/\s+/g, ' ').slice(0, 200));
    }
    match = wherePattern.exec(callBody);
  }
  return offenders;
}

describe('subscription read paths never filter through the plan relation', () => {
  const files = listTsFiles(SRC_ROOT);

  it('finds source files to scan (guards against a broken scanner)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no subscription query filters on the plan relation', () => {
    const callPattern = new RegExp(
      String.raw`\bsubscription\s*\.\s*(${MATCHING_OPS.join('|')})\s*\(`,
      'g',
    );
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('subscription.')) continue;

      let match = callPattern.exec(source);
      while (match !== null) {
        const callBody = readBalanced(source, match.index + match[0].length - 1, '(', ')');
        for (const offender of findPlanRelationFilters(callBody)) {
          const line = source.slice(0, match.index).split('\n').length;
          violations.push(
            `${relative(SRC_ROOT, file).split(sep).join('/')}:${line} (${match[1]}) — ${offender}`,
          );
        }
        match = callPattern.exec(source);
      }
    }

    expect(violations).toEqual([]);
  });

  it('the scanner actually catches a plan-relation filter', () => {
    const sample = `
      const rows = await this.prisma.subscription.findMany({
        where: { status: 'active', plan: { isArchived: false } },
        include: { plan: true },
      });
    `;
    const start = sample.indexOf('findMany(') + 'findMany'.length;
    const body = readBalanced(sample, start, '(', ')');

    expect(findPlanRelationFilters(body)).toHaveLength(1);
    // `include: { plan: true }` and planCode/planId filters must not trip it.
    expect(
      findPlanRelationFilters(
        readBalanced(
          `x({ where: { planCode: 'free', planId: null }, include: { plan: true } })`,
          1,
          '(',
          ')',
        ),
      ),
    ).toEqual([]);
  });
});
