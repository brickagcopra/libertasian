'use client';

import { useState } from 'react';
import { BanIcon, ClockIcon, TriangleAlertIcon } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { formatDateTime } from '../sla';
import {
  REASON_LABELS,
  type ModerationAuthorProfile,
  type ModerationSanction,
  type SanctionType,
} from '../types';
import { SanctionDialog } from './case-action-dialogs';
import { SanctionTypeBadge } from './moderation-badges';
import { RevokeSanctionDialog } from './sanctions-list';

function sanctionSummary(s: ModerationSanction): string {
  if (s.type === 'warning') return `Issued ${formatDateTime(s.startsAt)}`;
  return s.endsAt ? `Until ${formatDateTime(s.endsAt)}` : 'Permanent';
}

export function AuthorPanel({
  profile,
  canAct,
}: {
  profile: ModerationAuthorProfile;
  canAct: boolean;
}) {
  const [sanctionType, setSanctionType] = useState<SanctionType | null>(null);
  const [revoking, setRevoking] = useState<ModerationSanction | null>(null);
  const active = profile.activeSanction;
  const { stats } = profile;

  const statRows: Array<[string, number]> = [
    ['Posts', stats.posts],
    ['Comments', stats.comments],
    ['Removed content', stats.removedContent],
    ['Reports against', stats.reportsAgainst],
    ['Upheld reports', stats.upheldReports],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Author</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="font-medium">{profile.fullName}</p>
          <p className="text-xs text-muted-foreground">
            Joined {formatDateTime(profile.joinedAt)}
            {profile.accountStatus !== 'active' && ` · account ${profile.accountStatus.replace(/_/g, ' ')}`}
          </p>
        </div>

        {active && (
          <Alert variant="destructive">
            <AlertTitle>
              Currently {active.type === 'ban' ? 'banned' : 'suspended'}
            </AlertTitle>
            <AlertDescription>
              <p>
                {REASON_LABELS[active.reason]} · {sanctionSummary(active)}
              </p>
              {canAct && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => setRevoking(active)}
                >
                  Revoke
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          {statRows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!canAct}
            onClick={() => setSanctionType('warning')}
          >
            <TriangleAlertIcon />
            Warn
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canAct}
            onClick={() => setSanctionType('suspension')}
          >
            <ClockIcon />
            Suspend
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={!canAct}
            onClick={() => setSanctionType('ban')}
          >
            <BanIcon />
            Ban
          </Button>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold">Past sanctions</h3>
          {profile.sanctions.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="space-y-2">
              {profile.sanctions.map((s) => (
                <li key={s.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <SanctionTypeBadge type={s.type} />
                    <span>{REASON_LABELS[s.reason]}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(s.startsAt)}
                    {s.issuedBy ? ` by ${s.issuedBy.fullName}` : ''}
                    {s.revokedAt
                      ? ` · revoked ${formatDateTime(s.revokedAt)}`
                      : s.type !== 'warning'
                        ? ` · ${sanctionSummary(s).toLowerCase()}`
                        : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      <SanctionDialog
        type={sanctionType}
        userId={profile.id}
        userName={profile.fullName}
        onClose={() => setSanctionType(null)}
      />
      <RevokeSanctionDialog sanction={revoking} onClose={() => setRevoking(null)} />
    </Card>
  );
}
