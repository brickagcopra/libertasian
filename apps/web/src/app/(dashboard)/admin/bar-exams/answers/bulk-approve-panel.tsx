'use client';

import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MIN_BULK_CONFIDENCE,
  type BulkReviewResult,
} from '@/features/admin/hooks/use-admin-bar-exam-answers';

export interface BulkConfidenceFilter {
  year?: number;
  subjectCode?: string;
  minConfidence: number;
}

export interface BulkApprovePanelProps {
  isChecking: boolean;
  isApplying: boolean;
  preview: BulkReviewResult | null;
  errorMessage?: string | null;
  onPreview: (filter: BulkConfidenceFilter) => void;
  onConfirm: (filter: BulkConfidenceFilter) => void;
  onResetPreview: () => void;
}

/**
 * Approve every pending answer at or above a confidence, optionally scoped to
 * a year / subject.
 *
 * The floor is 0.70 and cannot be lowered from here: below it the scoring
 * contract calls a row `needs_human_review`, and this is the one path where
 * nobody reads the rows. Unscored (v1, priors-only) rows are never included —
 * they were never measured on the grounded terms at all.
 */
export function BulkApprovePanel({
  isChecking,
  isApplying,
  preview,
  errorMessage,
  onPreview,
  onConfirm,
  onResetPreview,
}: BulkApprovePanelProps) {
  const [year, setYear] = useState('');
  const [subjectCode, setSubjectCode] = useState('');
  const [minConfidence, setMinConfidence] = useState(String(MIN_BULK_CONFIDENCE));

  const parsedConfidence = Number(minConfidence);
  const confidenceInvalid =
    Number.isNaN(parsedConfidence) ||
    parsedConfidence < MIN_BULK_CONFIDENCE ||
    parsedConfidence > 1;

  const filter: BulkConfidenceFilter = {
    year: year ? Number(year) : undefined,
    subjectCode: subjectCode.trim() || undefined,
    minConfidence: parsedConfidence,
  };

  const changeAndInvalidate = (apply: () => void) => {
    apply();
    if (preview) onResetPreview();
  };

  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Bulk approve by confidence
        </h2>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-year">Year</Label>
            <Input
              id="bulk-year"
              type="number"
              className="w-28"
              value={year}
              onChange={(e) => changeAndInvalidate(() => setYear(e.target.value))}
              placeholder="any"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-subject">Subject code</Label>
            <Input
              id="bulk-subject"
              className="w-44"
              value={subjectCode}
              onChange={(e) =>
                changeAndInvalidate(() => setSubjectCode(e.target.value))
              }
              placeholder="any"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-confidence">Min confidence</Label>
            <Input
              id="bulk-confidence"
              type="number"
              step="0.01"
              min={MIN_BULK_CONFIDENCE}
              max={1}
              className="w-28"
              value={minConfidence}
              onChange={(e) =>
                changeAndInvalidate(() => setMinConfidence(e.target.value))
              }
            />
          </div>

          <Button
            type="button"
            disabled={confidenceInvalid || isChecking || isApplying}
            onClick={() =>
              preview ? onConfirm(filter) : onPreview(filter)
            }
          >
            {isChecking
              ? 'Checking…'
              : isApplying
                ? 'Approving…'
                : preview
                  ? `Approve ${preview.matched}`
                  : 'Check count'}
          </Button>
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          Floor is {MIN_BULK_CONFIDENCE.toFixed(2)}. Only pending answers are
          touched, and <strong>unscored answers are never included</strong> — a
          row with no confidence was never scored, which is not the same as
          scoring low.
        </p>

        {confidenceInvalid && (
          <p className="mt-1 text-xs text-destructive">
            Min confidence must be between {MIN_BULK_CONFIDENCE.toFixed(2)} and
            1.00.
          </p>
        )}

        {preview && (
          <Alert className="mt-3">
            <AlertDescription>
              <strong>
                {preview.matched} pending answer
                {preview.matched === 1 ? '' : 's'} match.
              </strong>{' '}
              {preview.byYearSubject.length > 0 && (
                <span className="text-xs text-muted-foreground">
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
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
