import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Drift guard for Prisma `BigInt` columns.
 *
 * `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt`.
 * A `BigInt` column therefore 500s every route that returns it — and every
 * Redis cache write that stringifies it — unless the reading code converts it
 * to `number` first. That is not a compile error and not something a Prisma
 * type catches: it surfaces at runtime, in production, as a blank page.
 *
 * `AnalyticsDailyAggregate.metricValue` is currently the ONLY BigInt in the
 * schema, and it is converted in
 * `AnalyticsDashboardService.queryAggregates`. This spec fails the moment a
 * second one appears, so whoever adds it is told, at that moment, that the
 * field needs a conversion at its read site.
 *
 * Adding a BigInt field is fine. Add it to KNOWN_BIGINT_FIELDS below once the
 * code that reads it converts the value on the way out.
 */

const SCHEMA_PATH = join(__dirname, '..', '..', 'prisma', 'schema.prisma');

/** `Model.field` for every BigInt column that has a conversion at its read site. */
const KNOWN_BIGINT_FIELDS: ReadonlyArray<string> = [
  // Converted in analytics-dashboard.service.ts → queryAggregates()
  'AnalyticsDailyAggregate.metricValue',
];

/** Every `Model.field` in schema.prisma whose type is BigInt (or BigInt?/BigInt[]). */
function findBigIntFields(schema: string): string[] {
  const found: string[] = [];
  let currentModel: string | null = null;

  for (const rawLine of schema.split('\n')) {
    const line = rawLine.trim();

    const modelStart = /^model\s+(\w+)\s*\{/.exec(line);
    if (modelStart) {
      currentModel = modelStart[1] ?? null;
      continue;
    }

    if (line === '}') {
      currentModel = null;
      continue;
    }

    if (!currentModel || line.startsWith('//') || line.startsWith('@@')) continue;

    // `fieldName  BigInt   @map("...")` — type is the second token.
    const field = /^(\w+)\s+(BigInt)(\?|\[\])?\b/.exec(line);
    if (field) found.push(`${currentModel}.${field[1]}`);
  }

  return found;
}

describe('Prisma BigInt serialization drift guard', () => {
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');

  it('parses models and fields out of schema.prisma', () => {
    // Sanity check on the parser itself: if the schema format ever changes
    // under it, this suite must fail loudly rather than find nothing and pass.
    expect(schema).toContain('model AnalyticsDailyAggregate');
    expect(findBigIntFields(schema).length).toBeGreaterThan(0);
  });

  it('has no BigInt field without a documented conversion', () => {
    const undocumented = findBigIntFields(schema).filter(
      (field) => !KNOWN_BIGINT_FIELDS.includes(field),
    );

    if (undocumented.length > 0) {
      // A bare array diff would not tell the next person what to do.
      throw new Error(
        `schema.prisma declares BigInt field(s) with no recorded conversion: ` +
          `${undocumented.join(', ')}.
` +
          `JSON.stringify throws on a BigInt, so any route or cache write that ` +
          `returns one will 500 at runtime. Convert the value to a number where ` +
          `it is read (see AnalyticsDashboardService.queryAggregates), then add ` +
          `the field to KNOWN_BIGINT_FIELDS in this spec.`,
      );
    }

    expect(undocumented).toEqual([]);
  });

  it('lists no stale entries in KNOWN_BIGINT_FIELDS', () => {
    const actual = findBigIntFields(schema);
    const stale = KNOWN_BIGINT_FIELDS.filter((field) => !actual.includes(field));

    expect(stale).toEqual([]);
  });
});
