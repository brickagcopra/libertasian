'use client';

import { useParams } from 'next/navigation';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertCircleIcon,
  BookOpenIcon,
  CalendarIcon,
  FileTextIcon,
  LayersIcon,
  StarIcon,
  UserIcon,
} from 'lucide-react';

import { ExpertBadge } from '@/features/community/components/expert-badge';
import { StarRatingDisplay } from '@/features/community/components/star-rating';
import { useContributorProfile } from '@/features/community/hooks/use-marketplace';

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="size-16 animate-pulse rounded-full bg-muted" />
        <div className="space-y-2">
          <div className="h-6 w-48 animate-pulse rounded bg-muted" />
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-4">
            <div className="h-8 w-12 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-20 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

const STAT_CARDS = [
  {
    key: 'flashcardSetCount' as const,
    label: 'Flashcard Sets',
    icon: LayersIcon,
  },
  {
    key: 'reviewerPackCount' as const,
    label: 'Reviewer Packs',
    icon: BookOpenIcon,
  },
  {
    key: 'digestCount' as const,
    label: 'Digests',
    icon: FileTextIcon,
  },
  {
    key: 'totalRatingsReceived' as const,
    label: 'Ratings Received',
    icon: StarIcon,
  },
];

export default function ContributorProfilePage() {
  const params = useParams<{ userId: string }>();
  const { data, isLoading, error } = useContributorProfile(params.userId);

  if (isLoading) return <ProfileSkeleton />;

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon className="size-4" />
        <AlertDescription>
          Failed to load contributor profile:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </AlertDescription>
      </Alert>
    );
  }

  const profile = data?.data;
  if (!profile) return null;

  return (
    <div className="space-y-6">
      {/* Profile header */}
      <div className="flex items-center gap-4">
        <div className="flex size-16 items-center justify-center rounded-full bg-muted text-xl font-bold text-muted-foreground">
          {profile.user.fullName.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{profile.user.fullName}</h1>
            {profile.expertVerification && (
              <ExpertBadge
                expertiseType={profile.expertVerification.expertiseType}
                status={profile.expertVerification.status}
                size="md"
              />
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <CalendarIcon className="size-3.5" />
              <span>
                Joined {new Date(profile.user.createdAt).toLocaleDateString('en-PH', {
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            </div>
            {profile.stats.avgRating != null && (
              <div className="flex items-center gap-1">
                <UserIcon className="size-3.5" />
                <span>Average rating:</span>
                <StarRatingDisplay value={profile.stats.avgRating} size="sm" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        {STAT_CARDS.map((stat) => {
          const Icon = stat.icon;
          const value = profile.stats[stat.key];

          return (
            <Card key={stat.key}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Icon className="size-4" />
                  {stat.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{value}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
