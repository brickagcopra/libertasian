'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckIcon, EyeIcon, EyeOffIcon } from 'lucide-react';

import type { DerivativeDetail } from '../types';
import { GatedNotice } from './gated-notice';
import { Unavailable } from './unavailable';

interface McqOption {
  label: string;
  text: string;
  isCorrect: boolean;
  rationale?: string;
}

interface McqContent {
  questionStem?: string;
  options?: McqOption[];
  explanation?: string;
}

function isMcqContent(value: unknown): value is McqContent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (typeof v['questionStem'] === 'string' || v['questionStem'] === undefined) &&
    (Array.isArray(v['options']) || v['options'] === undefined)
  );
}

export function MCQRenderer({ data }: { data: DerivativeDetail }) {
  const [revealed, setRevealed] = useState(false);

  if (!isMcqContent(data.contentJson)) {
    return <Unavailable />;
  }

  const content = data.contentJson;
  const stem = content.questionStem ?? '';
  const options = content.options ?? [];
  const explanation = content.explanation ?? '';

  if (!stem || options.length === 0) {
    return <Unavailable />;
  }

  const showAnswer = !data.isGated && revealed;

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      <h3 className="not-prose text-lg font-semibold">{stem}</h3>

      <ul className="not-prose mt-4 space-y-2">
        {options.map((opt, idx) => {
          const correctBadge =
            showAnswer && opt.isCorrect ? (
              <Badge className="ml-2 border-green-600 bg-green-50 text-green-800">
                <CheckIcon className="mr-1 h-3 w-3" /> Correct
              </Badge>
            ) : null;
          return (
            <li
              key={`${opt.label}-${idx}`}
              className="rounded-md border border-border p-3"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-muted text-sm font-semibold">
                  {opt.label}
                </span>
                <div className="flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm">{opt.text}</p>
                    {correctBadge}
                  </div>
                  {showAnswer && opt.rationale && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      <span className="font-medium">Rationale:</span> {opt.rationale}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {data.isGated ? (
        <div className="not-prose mt-6">
          <GatedNotice typeLabel="MCQ" upgradeTier={data.upgradeTier} />
        </div>
      ) : (
        <div className="not-prose mt-6 space-y-4">
          <Button variant="outline" size="sm" onClick={() => setRevealed((v) => !v)}>
            {revealed ? (
              <>
                <EyeOffIcon className="mr-2 h-4 w-4" /> Hide answer
              </>
            ) : (
              <>
                <EyeIcon className="mr-2 h-4 w-4" /> Reveal answer
              </>
            )}
          </Button>

          {revealed && explanation && (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-semibold">Explanation</p>
                <p className="mt-2 text-sm text-muted-foreground">{explanation}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </article>
  );
}
