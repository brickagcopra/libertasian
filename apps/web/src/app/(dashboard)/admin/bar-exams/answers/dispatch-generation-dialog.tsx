'use client';

import { useEffect, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { YearSubjectCount } from '@/features/admin/hooks/use-admin-bar-exam-answers';

export interface DispatchFormValue {
  year?: number;
  subjectCode?: string;
  sittingId?: string;
  allMissing?: boolean;
}

export interface DispatchPreview {
  total: number;
  byYearSubject: YearSubjectCount[];
}

export interface DispatchGenerationDialogProps {
  open: boolean;
  /** Prefilled when opened from a coverage cell or "Generate all missing". */
  initialValue?: DispatchFormValue;
  isChecking: boolean;
  isDispatching: boolean;
  /** Result of the dry run. Null until one has been made for these filters. */
  preview: DispatchPreview | null;
  errorMessage?: string | null;
  onCancel: () => void;
  onPreview: (value: DispatchFormValue) => void;
  onConfirm: (value: DispatchFormValue) => void;
  /** Drop a stale preview when the filters change under it. */
  onResetPreview: () => void;
}

/**
 * Presentational dispatch dialog. Pure props in / callbacks out so the
 * page-level test can drive it without standing up TanStack Query.
 *
 * Two steps, always: a dry run that reports how many questions the filters
 * actually resolve to, then a confirm. The old single-step dialog could only
 * say "up to 50 per request", which was both a cap and a guess.
 */
export function DispatchGenerationDialog({
  open,
  initialValue,
  isChecking,
  isDispatching,
  preview,
  errorMessage,
  onCancel,
  onPreview,
  onConfirm,
  onResetPreview,
}: DispatchGenerationDialogProps) {
  const [year, setYear] = useState('');
  const [subjectCode, setSubjectCode] = useState('');
  const [sittingId, setSittingId] = useState('');
  const [allMissing, setAllMissing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setYear(initialValue?.year ? String(initialValue.year) : '');
    setSubjectCode(initialValue?.subjectCode ?? '');
    setSittingId(initialValue?.sittingId ?? '');
    setAllMissing(initialValue?.allMissing ?? false);
  }, [open, initialValue]);

  if (!open) return null;

  const yearNum = year ? Number(year) : undefined;
  const yearInvalid = Boolean(year) && Number.isNaN(yearNum);
  const hasAnyFilter = Boolean(year || subjectCode || sittingId || allMissing);

  const value: DispatchFormValue = {
    year: yearNum,
    subjectCode: subjectCode.trim() || undefined,
    sittingId: sittingId.trim() || undefined,
    allMissing: allMissing || undefined,
  };

  const changeAndInvalidate = (apply: () => void) => {
    apply();
    if (preview) onResetPreview();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasAnyFilter || yearInvalid) return;
    if (preview) {
      onConfirm(value);
    } else {
      onPreview(value);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Generate AI answers"
        className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
      >
        <h2 className="text-lg font-semibold">Generate AI answers</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Resolves the filters into a set of past bar exam questions that have
          no AI answer yet, and queues one generation job for them. New answers
          land in the queue as <strong>Pending</strong> for review.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dispatch-year">Year</Label>
            <Input
              id="dispatch-year"
              type="number"
              inputMode="numeric"
              min={2006}
              max={2030}
              value={year}
              disabled={allMissing}
              onChange={(e) =>
                changeAndInvalidate(() => setYear(e.target.value))
              }
              placeholder="e.g. 2018"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dispatch-subject">Subject code</Label>
            <Input
              id="dispatch-subject"
              value={subjectCode}
              disabled={allMissing}
              onChange={(e) =>
                changeAndInvalidate(() => setSubjectCode(e.target.value))
              }
              placeholder="e.g. criminal_law"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dispatch-sitting">Sitting ID (UUID)</Label>
            <Input
              id="dispatch-sitting"
              value={sittingId}
              disabled={allMissing}
              onChange={(e) =>
                changeAndInvalidate(() => setSittingId(e.target.value))
              }
              placeholder="bar_exam_sittings.id"
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              id="dispatch-all-missing"
              type="checkbox"
              className="mt-0.5"
              checked={allMissing}
              onChange={(e) =>
                changeAndInvalidate(() => setAllMissing(e.target.checked))
              }
            />
            <span>
              Every unanswered question
              <span className="block text-xs text-muted-foreground">
                Ignores the filters above and targets the whole corpus.
              </span>
            </span>
          </label>

          {preview && (
            <Alert>
              <AlertDescription>
                <strong>
                  {preview.total} question{preview.total === 1 ? '' : 's'} will be
                  generated.
                </strong>
                {preview.byYearSubject.length > 0 && (
                  <span className="mt-1 block max-h-24 overflow-y-auto text-xs text-muted-foreground">
                    {preview.byYearSubject
                      .map(
                        (b) =>
                          `${b.year} · ${b.subjectCode ?? 'unclassified'}: ${b.count}`,
                      )
                      .join(' — ')}
                  </span>
                )}
              </AlertDescription>
            </Alert>
          )}

          {errorMessage && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              At least one filter is required.
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  !hasAnyFilter || isChecking || isDispatching || yearInvalid
                }
              >
                {isChecking
                  ? 'Checking…'
                  : isDispatching
                    ? 'Queueing…'
                    : preview
                      ? `Confirm — generate ${preview.total}`
                      : 'Check count'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
