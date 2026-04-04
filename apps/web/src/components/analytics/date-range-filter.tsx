'use client';

import type { AnalyticsDashboardQuery } from '@libertasian/types';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split('T')[0];
}

function defaultTo(): string {
  return new Date().toISOString().split('T')[0];
}

interface DateRangeFilterProps {
  query: AnalyticsDashboardQuery;
  onChange: (q: AnalyticsDashboardQuery) => void;
  showGranularity?: boolean;
  showDimension?: boolean;
}

export function DateRangeFilter({
  query,
  onChange,
  showGranularity = true,
  showDimension = false,
}: DateRangeFilterProps) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="space-y-1">
        <Label className="text-xs">Start Date</Label>
        <Input
          type="date"
          className="h-8 w-40"
          value={query.from ?? defaultFrom()}
          onChange={(e) => onChange({ ...query, from: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">End Date</Label>
        <Input
          type="date"
          className="h-8 w-40"
          value={query.to ?? defaultTo()}
          onChange={(e) => onChange({ ...query, to: e.target.value })}
        />
      </div>
      {showGranularity && (
        <div className="space-y-1">
          <Label className="text-xs">Granularity</Label>
          <Select
            value={query.granularity ?? 'day'}
            onValueChange={(v) =>
              onChange({ ...query, granularity: v as 'day' | 'week' | 'month' })
            }
          >
            <SelectTrigger className="h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Daily</SelectItem>
              <SelectItem value="week">Weekly</SelectItem>
              <SelectItem value="month">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {showDimension && (
        <div className="space-y-1">
          <Label className="text-xs">Dimension</Label>
          <Select
            value={query.dimension ?? 'plan'}
            onValueChange={(v) =>
              onChange({ ...query, dimension: v as 'plan' | 'device' | 'subject' })
            }
          >
            <SelectTrigger className="h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="plan">Plan</SelectItem>
              <SelectItem value="device">Device</SelectItem>
              <SelectItem value="subject">Subject</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
