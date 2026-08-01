'use client';

import { Volume2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SectionListenButtonProps {
  sectionId: string;
  /** Accessible label, e.g. "Listen to Article 1156". */
  label: string;
  /** True when this section is the one loaded into the page player. */
  isActive: boolean;
  onPlay: (sectionId: string) => void;
}

/**
 * Per-section play control. Deliberately INERT: a button and nothing else.
 *
 * The Civil Code has 2,533 sections. This renders once per section, so it must
 * not call `useAudioRendition`, must not mount an `<audio>` element, and must
 * not mount an `AudioPlayer` — 2,533 of those is a DOM and memory problem even
 * though none of them would fetch. Clicking hands the id to the ONE page-level
 * player, which is the only component that ever touches the audio endpoint.
 */
export function SectionListenButton({
  sectionId,
  label,
  isActive,
  onPlay,
}: SectionListenButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      aria-pressed={isActive}
      data-testid={`section-listen-${sectionId}`}
      onClick={() => onPlay(sectionId)}
      className={cn(
        'h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground',
        isActive && 'text-primary',
      )}
    >
      <Volume2 className="size-3.5" aria-hidden="true" />
      Listen
    </Button>
  );
}
