'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { RotateCwIcon } from 'lucide-react';

import type { DerivativeDetail } from '../types';
import { Unavailable } from './unavailable';

interface FlashcardEntry {
  front?: string;
  back?: string;
  mnemonicHint?: string | null;
  mnemonics?: string[];
  tags?: string[];
}

interface FlashcardContent {
  cards?: FlashcardEntry[];
  front?: string;
  back?: string;
  mnemonicHint?: string | null;
}

function extractCards(value: unknown): FlashcardEntry[] {
  if (!value || typeof value !== 'object') return [];
  const v = value as FlashcardContent;
  if (Array.isArray(v.cards) && v.cards.length > 0) return v.cards;
  if (typeof v.front === 'string' && typeof v.back === 'string') {
    return [{ front: v.front, back: v.back, mnemonicHint: v.mnemonicHint }];
  }
  return [];
}

function FlashCard({ card }: { card: FlashcardEntry }) {
  const [flipped, setFlipped] = useState(false);
  const front = card.front ?? '';
  const back = card.back ?? '';
  if (!front && !back) return null;

  return (
    <Card className="transition hover:shadow-sm">
      <CardContent className="flex min-h-[140px] flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {flipped ? 'Back' : 'Front'}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setFlipped((v) => !v)}>
            <RotateCwIcon className="mr-2 h-4 w-4" />
            {flipped ? 'Show front' : 'Flip'}
          </Button>
        </div>
        <p className="flex-1 whitespace-pre-wrap text-sm">{flipped ? back : front}</p>
        {flipped && card.mnemonicHint && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Mnemonic:</span> {card.mnemonicHint}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function FlashcardRenderer({ data }: { data: DerivativeDetail }) {
  const cards = extractCards(data.contentJson);
  if (cards.length === 0) return <Unavailable />;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cards.map((c, i) => (
        <FlashCard key={`card-${i}`} card={c} />
      ))}
    </div>
  );
}
