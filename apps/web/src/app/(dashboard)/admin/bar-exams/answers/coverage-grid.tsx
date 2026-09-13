'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type {
  CoverageCell,
  CoverageResult,
} from '@/features/admin/hooks/use-admin-bar-exam-answers';

export interface CoverageGridProps {
  coverage: CoverageResult;
  onGenerateMissing: (cell: CoverageCell) => void;
  onReviewPending: (cell: CoverageCell) => void;
}

/** Five buckets, so a cell's colour is readable as a coverage band. */
function shadeFor(answered: number, total: number): string {
  if (total === 0) return 'bg-muted text-muted-foreground';
  const ratio = answered / total;
  if (ratio === 0) return 'bg-red-50 text-red-900';
  if (ratio < 0.25) return 'bg-orange-50 text-orange-900';
  if (ratio < 0.75) return 'bg-yellow-50 text-yellow-900';
  if (ratio < 1) return 'bg-lime-50 text-lime-900';
  return 'bg-green-100 text-green-900';
}

function subjectLabel(code: string | null): string {
  if (!code) return 'unclassified';
  return code.replace(/_/g, ' ');
}

/**
 * Answer coverage as years × subjects.
 *
 * The grid is the part that was missing entirely: without it there was no way
 * to see which sittings had answers, so "generate answers" was a guess and
 * 1,375 unanswered questions were invisible behind a queue that only ever
 * showed the newest pending rows.
 */
export function CoverageGrid({
  coverage,
  onGenerateMissing,
  onReviewPending,
}: CoverageGridProps) {
  const [openCellKey, setOpenCellKey] = useState<string | null>(null);

  const { years, subjects, byKey } = useMemo(() => {
    const yearSet = new Set<number>();
    const subjectSet = new Set<string>();
    const map = new Map<string, CoverageCell>();
    for (const cell of coverage.cells) {
      yearSet.add(cell.year);
      subjectSet.add(cell.subjectCode ?? '');
      map.set(`${cell.year}::${cell.subjectCode ?? ''}`, cell);
    }
    return {
      years: [...yearSet].sort((a, b) => b - a),
      subjects: [...subjectSet].sort(),
      byKey: map,
    };
  }, [coverage.cells]);

  if (coverage.cells.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          No bar exam questions ingested yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Answer coverage
          </h2>
          <p className="text-xs text-muted-foreground">
            {coverage.totals.answered}/{coverage.totals.totalQuestions} answered ·{' '}
            {coverage.totals.missing} missing · {coverage.totals.pending} pending
            {coverage.totals.unscored > 0 && (
              <> · {coverage.totals.unscored} unscored</>
            )}
          </p>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-separate border-spacing-0.5 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-background px-2 py-1 text-left font-medium">
                  Year
                </th>
                {subjects.map((s) => (
                  <th
                    key={s || 'unclassified'}
                    className="px-2 py-1 text-left font-medium capitalize"
                  >
                    {subjectLabel(s || null)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {years.map((year) => (
                <tr key={year}>
                  <th className="sticky left-0 z-10 bg-background px-2 py-1 text-left font-medium">
                    {year}
                  </th>
                  {subjects.map((subject) => {
                    const key = `${year}::${subject}`;
                    const cell = byKey.get(key);
                    if (!cell) {
                      return (
                        <td
                          key={key}
                          className="rounded bg-muted/40 px-2 py-1 text-center text-muted-foreground"
                        >
                          —
                        </td>
                      );
                    }
                    return (
                      <td key={key} className="relative p-0">
                        <button
                          type="button"
                          aria-label={`${year} ${subjectLabel(
                            cell.subjectCode,
                          )}: ${cell.answered} of ${cell.totalQuestions} answered`}
                          onClick={() =>
                            setOpenCellKey(openCellKey === key ? null : key)
                          }
                          className={`w-full rounded px-2 py-1 text-center tabular-nums hover:ring-2 hover:ring-ring ${shadeFor(
                            cell.answered,
                            cell.totalQuestions,
                          )}`}
                        >
                          {cell.answered}/{cell.totalQuestions}
                        </button>

                        {openCellKey === key && (
                          <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-md border bg-background p-2 shadow-lg">
                            <p className="px-1 pb-1 text-[11px] text-muted-foreground">
                              {year} · {subjectLabel(cell.subjectCode)}
                            </p>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="w-full justify-start"
                              disabled={cell.missing === 0}
                              onClick={() => {
                                setOpenCellKey(null);
                                onGenerateMissing(cell);
                              }}
                            >
                              Generate missing ({cell.missing})
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="w-full justify-start"
                              disabled={cell.pending === 0}
                              onClick={() => {
                                setOpenCellKey(null);
                                onReviewPending(cell);
                              }}
                            >
                              Review pending ({cell.pending})
                            </Button>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <th className="sticky left-0 z-10 bg-background px-2 py-1 text-left font-semibold">
                  All
                </th>
                {subjects.map((subject) => {
                  const totals = coverage.cells
                    .filter((c) => (c.subjectCode ?? '') === subject)
                    .reduce(
                      (acc, c) => ({
                        answered: acc.answered + c.answered,
                        total: acc.total + c.totalQuestions,
                      }),
                      { answered: 0, total: 0 },
                    );
                  return (
                    <td
                      key={`total-${subject || 'unclassified'}`}
                      className="rounded bg-muted px-2 py-1 text-center font-semibold tabular-nums"
                    >
                      {totals.answered}/{totals.total}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
