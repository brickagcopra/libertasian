'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchIcon } from 'lucide-react';

import type { MarketplaceSortBy } from '../types';

interface MarketplaceFiltersProps {
  sortBy: MarketplaceSortBy;
  onSortChange: (value: MarketplaceSortBy) => void;
  barSubject: string;
  onBarSubjectChange: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  barSubjects?: Array<{ code: string; name: string }>;
}

const SORT_OPTIONS: Array<{ value: MarketplaceSortBy; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'top_rated', label: 'Top Rated' },
  { value: 'most_reviewed', label: 'Most Reviewed' },
  { value: 'trending', label: 'Trending' },
];

export function MarketplaceFilters({
  sortBy,
  onSortChange,
  barSubject,
  onBarSubjectChange,
  search,
  onSearchChange,
  barSubjects,
}: MarketplaceFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search */}
      <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
        <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by title..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Sort */}
      <Select value={sortBy} onValueChange={(v) => onSortChange(v as MarketplaceSortBy)}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Bar Subject filter */}
      <Select value={barSubject} onValueChange={onBarSubjectChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All subjects" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All subjects</SelectItem>
          {barSubjects?.map((s) => (
            <SelectItem key={s.code} value={s.code}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
