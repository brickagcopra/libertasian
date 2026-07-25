/**
 * Query understanding. Pure and dependency-free so it can be exhaustively
 * table-tested without a Nest module or a live cluster.
 *
 * The classifier's job is narrow: decide what KIND of thing the user typed so
 * the query builder can add precise clauses (`term` on `gr_no_digits`, a
 * `decision_date` range, a `ponente` boost) instead of throwing everything at
 * one fuzzy `multi_match`. It never rewrites the user's words — `cleanedQuery`
 * only strips quote characters and collapses whitespace.
 */

export type QueryIntentKind =
  | 'citation'
  | 'statute'
  | 'date'
  | 'person'
  | 'party_case'
  | 'phrase'
  | 'general';

export type DateGranularity = 'day' | 'month' | 'year';

export interface QueryDateRange {
  /** Inclusive ISO lower bound. */
  gte: string;
  /** Exclusive ISO upper bound. */
  lt: string;
  granularity: DateGranularity;
}

export interface QueryCitation {
  /** The citation exactly as the user typed it. */
  raw: string;
  /** Digits-and-hyphens form, for the `gr_no_digits` keyword field. */
  digits?: string;
  /** True when the user typed a bare number with no docket prefix. */
  bare: boolean;
}

export interface QueryIntent {
  kind: QueryIntentKind;
  /** Whitespace-collapsed query with quote characters removed. */
  cleanedQuery: string;
  citation?: QueryCitation;
  dateRange?: QueryDateRange;
  personName?: string;
  /** Contents of every double-quoted span, in order. */
  exactPhrases: string[];
  /**
   * True when the query is *nothing but* the detected date, which is the only
   * case where the date becomes a hard filter rather than an additive boost.
   */
  dateOnly: boolean;
}

export interface ClassifyOptions {
  /**
   * Known ponente surnames, upper-cased. Supplied by PonenteDirectoryService;
   * an empty/absent set fails open (no `person` classification), never throws.
   */
  ponenteAllowList?: ReadonlySet<string>;
  /** Injected for testability — defaults to the current year. */
  currentYear?: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** `G.R. No. 123456`, `GR 123456`, `G.R. Nos. 205528-29`, `G.R. No. L-12345` */
const GR_PATTERN =
  /\b(?:g\.?\s?r\.?|grn)\s*(?:nos?\.?)?\s*(l-)?(\d[\d\s,-]*\d|\d)\b/i;

/** `A.M. No. P-15-3290`, `A.C. No. 1234`, `UDK-16915`, `B.M. No. 1234` */
const DOCKET_PATTERN =
  /\b(a\.?\s?m\.?|a\.?\s?c\.?|b\.?\s?m\.?|udk)[\s.-]*(?:nos?\.?)?\s*([a-z0-9][a-z0-9-]*\d[a-z0-9-]*)\b/i;

/** `RA 8353`, `R.A. No. 8353`, `Republic Act No. 8353`, `PD 1529`, `EO 292`, `BP 22` */
const STATUTE_PATTERN =
  /\b(republic\s+act|commonwealth\s+act|batas\s+pambansa|presidential\s+decree|executive\s+order|r\.?\s?a\.?|c\.?\s?a\.?|b\.?\s?p\.?|p\.?\s?d\.?|e\.?\s?o\.?)\s*(?:blg\.?|nos?\.?)?\s*(\d+)\b/i;

/** `Rule 65`, `Art. 315`, `Article 36`, `Sec. 5`, `Section 5` */
const RULE_PATTERN = /\b(rule|art\.?|article|sec\.?|section)\s*(\d+[a-z]?)\b/i;

const ISO_DATE_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const LONG_DATE_PATTERN = /\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/i;
const MONTH_YEAR_PATTERN = /\b([a-z]{3,9})\.?\s+(\d{4})\b/i;
const BARE_NUMBER_PATTERN = /^\d{4,6}$/;
const PARTY_PATTERN = /\s(?:v\.|vs\.?|versus)\s/i;
const JUSTICE_PATTERN = /\b(?:j\.|justice|hon\.)\s*([a-z][a-z'-]+)\b/i;

/** Digits-and-hyphens form used for the `gr_no_digits` keyword field. */
function toDigits(value: string): string | undefined {
  const digits = value
    .replace(/[^\d-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return digits.length > 0 ? digits : undefined;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dayRange(year: number, month: number, day: number): QueryDateRange {
  const start = new Date(Date.UTC(year, month - 1, day));
  const end = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    gte: start.toISOString(),
    lt: end.toISOString(),
    granularity: 'day',
  };
}

function monthRange(year: number, month: number): QueryDateRange {
  return {
    gte: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    lt: new Date(Date.UTC(year, month, 1)).toISOString(),
    granularity: 'month',
  };
}

function yearRange(year: number): QueryDateRange {
  return {
    gte: new Date(Date.UTC(year, 0, 1)).toISOString(),
    lt: new Date(Date.UTC(year + 1, 0, 1)).toISOString(),
    granularity: 'year',
  };
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Extract every double-quoted span. Unterminated quotes yield nothing. */
function extractPhrases(raw: string): string[] {
  const phrases: string[] = [];
  const pattern = /"([^"]+)"/g;
  let match = pattern.exec(raw);
  while (match !== null) {
    const phrase = match[1]!.trim();
    if (phrase.length > 0) phrases.push(phrase);
    match = pattern.exec(raw);
  }
  return phrases;
}

/**
 * Detect a date anywhere in the query. Returns the range plus the exact text
 * matched, so the caller can decide whether the query was date-ONLY.
 */
function detectDate(
  query: string,
  currentYear: number,
): { range: QueryDateRange; matched: string } | null {
  const iso = ISO_DATE_PATTERN.exec(query);
  if (iso) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (isRealDate(year, month, day)) {
      return { range: dayRange(year, month, day), matched: iso[0] };
    }
  }

  const long = LONG_DATE_PATTERN.exec(query);
  if (long) {
    const month = MONTHS[long[1]!.toLowerCase()];
    const day = Number(long[2]);
    const year = Number(long[3]);
    if (month && isRealDate(year, month, day)) {
      return { range: dayRange(year, month, day), matched: long[0] };
    }
  }

  const monthYear = MONTH_YEAR_PATTERN.exec(query);
  if (monthYear) {
    const month = MONTHS[monthYear[1]!.toLowerCase()];
    const year = Number(monthYear[2]);
    if (month) {
      return { range: monthRange(year, month), matched: monthYear[0] };
    }
  }

  // A bare 4-digit number is only a year when it is plausibly one AND the query
  // is just that token. `246999` is 6 digits (docket); `1998` alone is a year;
  // `G.R. No. 1998` is a docket because the token is not alone.
  const bareYear = /^\s*(\d{4})\s*$/.exec(query);
  if (bareYear) {
    const year = Number(bareYear[1]);
    if (year >= 1900 && year <= currentYear) {
      return { range: yearRange(year), matched: bareYear[1]! };
    }
  }

  return null;
}

/**
 * Classify a raw search query.
 *
 * Precedence, highest first: explicit citation → statute/rule → date-only →
 * party case → person → phrase → general. Citations win over dates because
 * `G.R. No. 1998` must not be read as the year 1998.
 */
export function classifyQuery(raw: string, options: ClassifyOptions = {}): QueryIntent {
  const currentYear = options.currentYear ?? new Date().getUTCFullYear();
  const exactPhrases = extractPhrases(raw);
  const cleanedQuery = raw.replace(/"/g, ' ').replace(/\s+/g, ' ').trim();

  const base: QueryIntent = {
    kind: 'general',
    cleanedQuery,
    exactPhrases,
    dateOnly: false,
  };

  if (cleanedQuery.length === 0) return base;

  // --- 1. explicit docket / G.R. citation ---
  const gr = GR_PATTERN.exec(cleanedQuery);
  if (gr) {
    const digits = toDigits(gr[2]!);
    return {
      ...base,
      kind: 'citation',
      citation: { raw: gr[0].trim(), ...(digits && { digits }), bare: false },
    };
  }

  const docket = DOCKET_PATTERN.exec(cleanedQuery);
  if (docket) {
    const digits = toDigits(docket[2]!);
    return {
      ...base,
      kind: 'citation',
      citation: { raw: docket[0].trim(), ...(digits && { digits }), bare: false },
    };
  }

  // --- 2. bare number ---
  // 4-digit bare numbers are ambiguous with years; 5-6 digit ones never are.
  // A 4-digit token that is a plausible year falls through to the date branch.
  const bare = BARE_NUMBER_PATTERN.exec(cleanedQuery);
  if (bare) {
    const value = Number(cleanedQuery);
    const looksLikeYear =
      cleanedQuery.length === 4 && value >= 1900 && value <= currentYear;
    if (!looksLikeYear) {
      return {
        ...base,
        kind: 'citation',
        citation: { raw: cleanedQuery, digits: cleanedQuery, bare: true },
      };
    }
  }

  // --- 3. statute / rule reference ---
  const statute = STATUTE_PATTERN.exec(cleanedQuery);
  if (statute) {
    return {
      ...base,
      kind: 'statute',
      citation: { raw: statute[0].trim(), digits: statute[2], bare: false },
    };
  }

  const rule = RULE_PATTERN.exec(cleanedQuery);
  if (rule) {
    return {
      ...base,
      kind: 'statute',
      citation: { raw: rule[0].trim(), bare: false },
    };
  }

  // --- 4. dates ---
  const date = detectDate(cleanedQuery, currentYear);
  const dateOnly =
    date !== null && date.matched.trim().length === cleanedQuery.length;

  // --- 5. party case (` v. `, ` vs. `, ` versus `) ---
  if (PARTY_PATTERN.test(cleanedQuery)) {
    return {
      ...base,
      kind: 'party_case',
      ...(date && { dateRange: date.range }),
    };
  }

  if (date && dateOnly) {
    return { ...base, kind: 'date', dateRange: date.range, dateOnly: true };
  }

  // --- 6. person (ponente) ---
  const personName = detectPerson(cleanedQuery, options.ponenteAllowList);
  if (personName) {
    return {
      ...base,
      kind: 'person',
      personName,
      ...(date && { dateRange: date.range }),
    };
  }

  // --- 7. explicit phrase ---
  if (exactPhrases.length > 0) {
    return {
      ...base,
      kind: 'phrase',
      ...(date && { dateRange: date.range }),
    };
  }

  return { ...base, ...(date && { dateRange: date.range }) };
}

/**
 * A person is either an explicit `J. Lopez` / `Justice Lopez` form, or a single
 * capitalised token that appears in the ponente allow-list. Requiring the
 * allow-list for the bare form is what stops every one-word query
 * (`Estafa`, `Certiorari`) being treated as a name.
 */
function detectPerson(
  query: string,
  allowList: ReadonlySet<string> | undefined,
): string | undefined {
  const titled = JUSTICE_PATTERN.exec(query);
  if (titled) return titled[1]!.toUpperCase();

  if (!allowList || allowList.size === 0) return undefined;

  const tokens = query.split(/\s+/);
  if (tokens.length !== 1) return undefined;

  const token = tokens[0]!;
  if (!/^[A-Za-z][A-Za-z'-]+$/.test(token)) return undefined;

  const upper = token.toUpperCase();
  return allowList.has(upper) ? upper : undefined;
}
