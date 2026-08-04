'use client';

import { useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookOpenIcon, FileTextIcon, SparklesIcon } from 'lucide-react';

import { useDigestCount } from '../hooks/use-digest-count';
import type { SearchMeta, SearchResultItem, SearchTab } from '../types';
import { AiSummaryResults } from './ai-summary-results';
import { DigestsResults } from './digests-results';
import { FullTextResults } from './full-text-results';

interface SearchTabsProps {
  query: string | null;
  results: SearchResultItem[];
  meta: SearchMeta | undefined;
  isLoading: boolean;
  error: Error | null;
  page: number;
  onPageChange: (page: number) => void;
}

export function SearchTabs({
  query,
  results,
  meta,
  isLoading,
  error,
  page,
  onPageChange,
}: SearchTabsProps) {
  const [activeTab, setActiveTab] = useState<SearchTab>('fulltext');
  // Same query key as the list below, so this is one request, not two.
  const { data: digestCount } = useDigestCount(query ?? '', !!query);

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as SearchTab)}
    >
      <TabsList>
        <TabsTrigger value="fulltext">
          <FileTextIcon className="size-4" />
          Full Text
          {meta && meta.total > 0 && (
            <span className="ml-1 rounded-full bg-muted-foreground/20 px-1.5 py-0.5 text-xs">
              {meta.total.toLocaleString()}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="ai-summary">
          <SparklesIcon className="size-4" />
          AI Summary
        </TabsTrigger>
        <TabsTrigger value="digests">
          <BookOpenIcon className="size-4" />
          Digests
          {typeof digestCount === 'number' && digestCount > 0 && (
            <span className="ml-1 rounded-full bg-muted-foreground/20 px-1.5 py-0.5 text-xs">
              {digestCount.toLocaleString()}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="fulltext">
        <FullTextResults
          results={results}
          meta={meta}
          page={page}
          onPageChange={onPageChange}
          isLoading={isLoading}
          error={error}
        />
      </TabsContent>

      <TabsContent value="ai-summary">
        {activeTab === 'ai-summary' && (
          <AiSummaryResults query={query} />
        )}
      </TabsContent>

      <TabsContent value="digests">
        {activeTab === 'digests' && <DigestsResults query={query} />}
      </TabsContent>
    </Tabs>
  );
}
