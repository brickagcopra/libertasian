'use client';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ShieldCheckIcon } from 'lucide-react';

import type { ExpertiseType, ExpertVerificationStatus } from '../types';

const EXPERTISE_LABELS: Record<ExpertiseType, string> = {
  lawyer: 'Lawyer',
  law_professor: 'Law Professor',
  judge_retired: 'Retired Judge',
  legal_researcher: 'Legal Researcher',
};

interface ExpertBadgeProps {
  expertiseType: ExpertiseType;
  status: ExpertVerificationStatus;
  size?: 'sm' | 'md';
}

export function ExpertBadge({ expertiseType, status, size = 'sm' }: ExpertBadgeProps) {
  if (status !== 'approved') return null;

  const label = EXPERTISE_LABELS[expertiseType] ?? expertiseType;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={
              size === 'sm'
                ? 'gap-1 border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] text-emerald-700'
                : 'gap-1.5 border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700'
            }
          >
            <ShieldCheckIcon className={size === 'sm' ? 'size-3' : 'size-3.5'} />
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>Verified {label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
