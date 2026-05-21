'use client';

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  BookOpenIcon,
  FileTextIcon,
  LayersIcon,
  ShieldCheckIcon,
  UsersIcon,
} from 'lucide-react';

import { FeaturedSection } from '@/features/community/components/featured-section';

const BROWSE_LINKS = [
  {
    href: '/community/flashcard-sets',
    label: 'Flashcard Sets',
    description: 'Study sets created by the community',
    icon: LayersIcon,
  },
  {
    href: '/community/reviewer-packs',
    label: 'Reviewer Packs',
    description: 'Curated review materials for bar subjects',
    icon: BookOpenIcon,
  },
  {
    href: '/community/digests',
    label: 'Case Digests',
    description: 'Community-contributed and AI-generated digests',
    icon: FileTextIcon,
  },
];

export default function CommunityPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <UsersIcon className="size-6 text-muted-foreground" />
          <h1 className="text-2xl font-bold">Community Marketplace</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Discover study materials, case digests, and reviewer packs shared by the
          legal community. Rate, review, and contribute your own.
        </p>
      </div>

      {/* Browse cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {BROWSE_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="size-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{link.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {link.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Expert verification CTA */}
      <Card>
        <CardContent className="flex items-center gap-4 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-50">
            <ShieldCheckIcon className="size-5 text-emerald-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Are you a legal professional?</p>
            <p className="text-xs text-muted-foreground">
              Get verified as an expert contributor to boost credibility of your
              shared materials.
            </p>
          </div>
          <Link href="/settings">
            <Badge variant="outline" className="shrink-0 cursor-pointer hover:bg-accent">
              Get Verified
            </Badge>
          </Link>
        </CardContent>
      </Card>

      {/* Featured section */}
      <FeaturedSection />
    </div>
  );
}
