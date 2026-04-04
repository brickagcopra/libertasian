'use client';

import { useCallback, useState } from 'react';

import { cn } from '@/lib/utils';
import { StarIcon } from 'lucide-react';

interface StarRatingDisplayProps {
  value: number | null;
  count?: number;
  size?: 'sm' | 'md';
}

/** Read-only star rating display */
export function StarRatingDisplay({ value, count, size = 'sm' }: StarRatingDisplayProps) {
  const stars = value ?? 0;
  const iconSize = size === 'sm' ? 'size-3.5' : 'size-4';

  return (
    <div className="flex items-center gap-1">
      <div className="flex">
        {[1, 2, 3, 4, 5].map((star) => (
          <StarIcon
            key={star}
            className={cn(
              iconSize,
              star <= Math.round(stars)
                ? 'fill-amber-400 text-amber-400'
                : 'fill-none text-gray-300',
            )}
          />
        ))}
      </div>
      {value != null && (
        <span className={cn('text-muted-foreground', size === 'sm' ? 'text-xs' : 'text-sm')}>
          {value.toFixed(1)}
        </span>
      )}
      {count != null && (
        <span className={cn('text-muted-foreground', size === 'sm' ? 'text-xs' : 'text-sm')}>
          ({count})
        </span>
      )}
    </div>
  );
}

interface StarRatingInputProps {
  value: number;
  onChange: (value: number) => void;
  size?: 'sm' | 'md';
}

/** Interactive star rating input */
export function StarRatingInput({ value, onChange, size = 'md' }: StarRatingInputProps) {
  const [hover, setHover] = useState(0);
  const iconSize = size === 'sm' ? 'size-5' : 'size-6';

  const handleClick = useCallback(
    (star: number) => {
      onChange(star);
    },
    [onChange],
  );

  return (
    <div className="flex">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className="p-0.5 transition-transform hover:scale-110"
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          onClick={() => handleClick(star)}
        >
          <StarIcon
            className={cn(
              iconSize,
              'transition-colors',
              star <= (hover || value)
                ? 'fill-amber-400 text-amber-400'
                : 'fill-none text-gray-300',
            )}
          />
        </button>
      ))}
    </div>
  );
}
