import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LockIcon } from 'lucide-react';

interface GatedNoticeProps {
  typeLabel: string;
  upgradeTier: string | null;
}

export function GatedNotice({ typeLabel, upgradeTier }: GatedNoticeProps) {
  const tier = upgradeTier ?? 'edu';
  return (
    <Card className="border-amber-200 bg-amber-50/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LockIcon className="h-4 w-4" /> Unlock full content
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {typeLabel} answers and explanations are available on the{' '}
          <span className="font-semibold capitalize">{tier}</span> plan and above. Upgrade to
          see the full solution, model answer, and rationale.
        </p>
        <Button asChild>
          <Link href="/pricing">Upgrade</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
