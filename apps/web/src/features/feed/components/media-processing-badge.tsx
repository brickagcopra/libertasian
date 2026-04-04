'use client';

import { Badge } from '@/components/ui/badge';
import { LoaderIcon, CheckCircleIcon, XCircleIcon, ShieldAlertIcon } from 'lucide-react';
import type { FeedMediaProcessingStatus } from '@libertasian/types';

interface MediaProcessingBadgeProps {
  status: FeedMediaProcessingStatus;
  failureReason?: string | null;
}

const STATUS_CONFIG: Record<
  FeedMediaProcessingStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ElementType }
> = {
  pending: { label: 'Pending', variant: 'secondary', icon: LoaderIcon },
  uploading: { label: 'Uploading...', variant: 'secondary', icon: LoaderIcon },
  processing: { label: 'Processing...', variant: 'default', icon: LoaderIcon },
  ready: { label: 'Ready', variant: 'outline', icon: CheckCircleIcon },
  failed: { label: 'Failed', variant: 'destructive', icon: XCircleIcon },
  quarantined: { label: 'Rejected', variant: 'destructive', icon: ShieldAlertIcon },
};

export function MediaProcessingBadge({ status, failureReason }: MediaProcessingBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  const isAnimated = status === 'pending' || status === 'uploading' || status === 'processing';

  return (
    <Badge variant={config.variant} className="gap-1" title={failureReason ?? undefined}>
      <Icon className={`size-3 ${isAnimated ? 'animate-spin' : ''}`} />
      {config.label}
    </Badge>
  );
}
