'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

interface KpiCardProps {
  label: string;
  value: string;
  trend?: 'up' | 'down' | 'neutral';
  comparison?: string;
  icon?: React.ElementType;
}

export function KpiCard({ label, value, trend, comparison, icon: Icon }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          {Icon && <Icon className="size-4 text-muted-foreground" />}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <p className="text-2xl font-bold">{value}</p>
          {trend === 'up' && <TrendingUp className="size-4 text-green-500" />}
          {trend === 'down' && <TrendingDown className="size-4 text-red-500" />}
          {trend === 'neutral' && <Minus className="size-4 text-muted-foreground" />}
        </div>
        {comparison && (
          <p className="mt-1 text-xs text-muted-foreground">{comparison}</p>
        )}
      </CardContent>
    </Card>
  );
}
