'use client';

import type { ComponentType, ReactNode } from 'react';

import {
  ArchiveEmptyIllustration,
  IngestPendingIllustration,
  ScalesEmptyIllustration,
} from './illustrations';

export type EmptyStateIllustration =
  | 'scales'
  | 'archive'
  | 'ingest-pending';

interface EmptyStateProps {
  illustration: EmptyStateIllustration;
  title: string;
  message?: ReactNode;
  action?: ReactNode;
  className?: string;
}

type IllustrationComponent = ComponentType<{
  className?: string;
  ariaLabel?: string;
}>;

const ILLUSTRATIONS: Record<EmptyStateIllustration, IllustrationComponent> = {
  scales: ScalesEmptyIllustration,
  archive: ArchiveEmptyIllustration,
  'ingest-pending': IngestPendingIllustration,
};

export function EmptyState({
  illustration,
  title,
  message,
  action,
  className,
}: EmptyStateProps) {
  const Illustration = ILLUSTRATIONS[illustration];
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-6 py-10 text-center ${className ?? ''}`}
    >
      <Illustration className="h-32 w-32 text-gray-700" />
      <h3 className="mt-4 text-base font-semibold text-gray-900">{title}</h3>
      {message && (
        <p className="mt-1 max-w-md text-sm text-gray-600">{message}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
