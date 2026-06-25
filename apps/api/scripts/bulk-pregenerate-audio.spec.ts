import {
  billedChars,
  decideItem,
  parseArgs,
  DEFAULT_CHAR_BUDGET,
  MAX_BILLED_CHARS,
  MAX_TOTAL_CHARS,
} from './bulk-pregenerate-audio';

describe('billedChars', () => {
  it('charges twice the normalized length (audio + speech marks)', () => {
    expect(billedChars(0)).toBe(0);
    expect(billedChars(1)).toBe(2);
    expect(billedChars(1500)).toBe(3000);
  });
});

describe('decideItem', () => {
  const base = {
    normalizedLength: 100,
    ssmlLength: 200,
    alreadyDone: false,
    spent: 0,
    budget: DEFAULT_CHAR_BUDGET,
  } as const;

  it('synthesizes a normal item with cost = 2 * normalizedLength', () => {
    const d = decideItem({ ...base, normalizedLength: 1200 });
    expect(d).toEqual({ action: 'synthesize', cost: 2400 });
  });

  describe('skip-long boundaries', () => {
    it('allows exactly the billed limit (3000) and total limit (6000)', () => {
      const d = decideItem({
        ...base,
        normalizedLength: MAX_BILLED_CHARS,
        ssmlLength: MAX_TOTAL_CHARS,
      });
      expect(d).toEqual({ action: 'synthesize', cost: 2 * MAX_BILLED_CHARS });
    });

    it('skips one char over the billed limit (3001)', () => {
      const d = decideItem({ ...base, normalizedLength: MAX_BILLED_CHARS + 1 });
      expect(d.action).toBe('skip_long');
    });

    it('skips one char over the total/SSML limit (6001)', () => {
      const d = decideItem({
        ...base,
        normalizedLength: 100,
        ssmlLength: MAX_TOTAL_CHARS + 1,
      });
      expect(d.action).toBe('skip_long');
    });

    it('skip-long wins over already-done and over budget (checked first, no budget)', () => {
      const d = decideItem({
        ...base,
        normalizedLength: MAX_BILLED_CHARS + 1,
        alreadyDone: true,
        spent: DEFAULT_CHAR_BUDGET, // budget already exhausted
        budget: DEFAULT_CHAR_BUDGET,
      });
      expect(d.action).toBe('skip_long');
    });
  });

  describe('already-done', () => {
    it('skips a ready rendition before consuming budget', () => {
      const d = decideItem({ ...base, alreadyDone: true });
      expect(d).toEqual({ action: 'already_done' });
    });

    it('already-done wins over budget-stop', () => {
      const d = decideItem({
        ...base,
        alreadyDone: true,
        normalizedLength: 1000,
        spent: DEFAULT_CHAR_BUDGET,
      });
      expect(d).toEqual({ action: 'already_done' });
    });
  });

  describe('budget ceiling', () => {
    it('synthesizes when cost exactly fills the remaining budget', () => {
      // remaining = 2000, cost = 2 * 1000 = 2000 → fits (not >)
      const d = decideItem({
        ...base,
        normalizedLength: 1000,
        spent: 8000,
        budget: 10000,
      });
      expect(d).toEqual({ action: 'synthesize', cost: 2000 });
    });

    it('stops when cost would overshoot the budget by one', () => {
      // remaining = 1999, cost = 2000 → over
      const d = decideItem({
        ...base,
        normalizedLength: 1000,
        spent: 8001,
        budget: 10000,
      });
      expect(d).toEqual({ action: 'budget_stop', cost: 2000 });
    });

    it('stops at a zero budget for any non-empty item', () => {
      const d = decideItem({ ...base, normalizedLength: 1, spent: 0, budget: 0 });
      expect(d).toEqual({ action: 'budget_stop', cost: 2 });
    });
  });
});

describe('parseArgs', () => {
  it('defaults to a dry-run cheapest run at the default budget', () => {
    expect(parseArgs([])).toEqual({
      commit: false,
      charBudget: DEFAULT_CHAR_BUDGET,
      order: 'cheapest',
      limit: undefined,
      skipReport: undefined,
    });
  });

  it('parses every flag', () => {
    expect(
      parseArgs([
        '--commit',
        '--char-budget=900000',
        '--order=oldest',
        '--limit=5',
        '--skip-report=/tmp/deferred.json',
      ]),
    ).toEqual({
      commit: true,
      charBudget: 900000,
      order: 'oldest',
      limit: 5,
      skipReport: '/tmp/deferred.json',
    });
  });

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
  });

  it('rejects a bad --order', () => {
    expect(() => parseArgs(['--order=newest'])).toThrow(/--order/);
  });

  it('rejects a negative / non-integer budget', () => {
    expect(() => parseArgs(['--char-budget=-1'])).toThrow(/--char-budget/);
    expect(() => parseArgs(['--char-budget=abc'])).toThrow(/--char-budget/);
  });

  it('rejects an empty --skip-report path', () => {
    expect(() => parseArgs(['--skip-report='])).toThrow(/--skip-report/);
  });
});
