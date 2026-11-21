'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { CaseDetail, isModerationTargetType } from '@/features/moderation/components/case-detail';
import { ROUTES } from '@/lib/constants';

export default function ModerationCasePage() {
  const params = useParams<{ targetType: string; targetId: string }>();
  const targetType = params?.targetType ?? '';
  const targetId = params?.targetId ?? '';

  if (!isModerationTargetType(targetType) || !targetId) {
    return (
      <div className="space-y-4">
        <Link href={ROUTES.ADMIN_MODERATION} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to queue
        </Link>
        <Alert variant="destructive">
          <AlertDescription>Unknown moderation case.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return <CaseDetail targetType={targetType} targetId={targetId} />;
}
