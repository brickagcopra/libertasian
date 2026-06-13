'use client';

import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MAX_PER_DISPATCH = 50;

export interface DispatchFormValue {
  year?: number;
  subjectCode?: string;
  sittingId?: string;
}

export interface DispatchGenerationDialogProps {
  open: boolean;
  isDispatching: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onDispatch: (value: DispatchFormValue) => void;
}

/**
 * Presentational dispatch dialog. Pure props in / callbacks out so the
 * page-level test can drive it without standing up TanStack Query.
 */
export function DispatchGenerationDialog({
  open,
  isDispatching,
  errorMessage,
  onCancel,
  onDispatch,
}: DispatchGenerationDialogProps) {
  const [year, setYear] = useState('');
  const [subjectCode, setSubjectCode] = useState('');
  const [sittingId, setSittingId] = useState('');

  if (!open) return null;

  const hasAnyFilter = year || subjectCode || sittingId;
  const yearNum = year ? Number(year) : undefined;
  const yearInvalid = year && Number.isNaN(yearNum);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasAnyFilter || yearInvalid) return;
    onDispatch({
      year: yearNum,
      subjectCode: subjectCode.trim() || undefined,
      sittingId: sittingId.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <h2 className="text-lg font-semibold">Generate AI answers</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Resolves the filters into a list of past bar exam questions and
          dispatches up to {MAX_PER_DISPATCH} per request to the worker. New
          answers land in the queue as <strong>Pending</strong> for review.
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
              onChange={(e) => setYear(e.target.value)}
              placeholder="e.g. 2018"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dispatch-subject">Subject code</Label>
            <Input
              id="dispatch-subject"
              value={subjectCode}
              onChange={(e) => setSubjectCode(e.target.value)}
              placeholder="e.g. criminal_law"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dispatch-sitting">Sitting ID (UUID)</Label>
            <Input
              id="dispatch-sitting"
              value={sittingId}
              onChange={(e) => setSittingId(e.target.value)}
              placeholder="bar_exam_sittings.id"
            />
          </div>

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
                disabled={!hasAnyFilter || isDispatching || Boolean(yearInvalid)}
              >
                {isDispatching
                  ? 'Dispatching…'
                  : `Dispatch (up to ${MAX_PER_DISPATCH} questions)`}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
