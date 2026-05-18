'use client';

import { useCallback, useMemo, useState } from 'react';

import { useSearch } from '@/features/search/hooks/use-search';
import { SearchTabs } from '@/features/search/components/search-tabs';
import type { SearchFilters } from '@/features/search/types';
import { UpgradeBanner, extractSearchQuota403 } from '@/components/paywall/upgrade-banner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchIcon, SlidersHorizontalIcon } from 'lucide-react';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Filter state
  const [documentType, setDocumentType] = useState('all');
  const [court, setCourt] = useState('all');
  const [ponente, setPonente] = useState('');
  const [grNo, setGrNo] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);

  const { data, isLoading, isFetching, error } = useSearch(filters);

  const handleSearch = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!query.trim()) return;
      setPage(0);
      setFilters({
        query: query.trim(),
        documentType: documentType !== 'all' ? documentType : undefined,
        court: court !== 'all' ? court : undefined,
        ponente: ponente || undefined,
        grNo: grNo || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page: 0,
        limit: 20,
      });
    },
    [query, documentType, court, ponente, grNo, dateFrom, dateTo],
  );

  const handlePageChange = useCallback(
    (newPage: number) => {
      setPage(newPage);
      if (filters) {
        setFilters({ ...filters, page: newPage });
      }
    },
    [filters],
  );

  const results = data?.data ?? [];
  const meta = data?.meta;

  const searchQuota = extractSearchQuota403(error);

  // Deduplicate document IDs from search results
  const documentIds = useMemo(() => {
    if (results.length === 0) return null;
    return [...new Set(results.map((r) => r.source.document_id))];
  }, [results]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Legal Search</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search across Philippine legal documents, jurisprudence, and codals
        </p>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cases, statutes, legal terms..."
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={!query.trim() || isLoading}>
          Search
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowFilters(!showFilters)}
        >
          <SlidersHorizontalIcon />
          <span className="hidden sm:inline">Filters</span>
        </Button>
      </form>

      {/* Filters Panel */}
      {showFilters && (
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label>Document Type</Label>
                <Select value={documentType} onValueChange={setDocumentType}>
                  <SelectTrigger>
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="supreme_court_decision">Supreme Court Decision</SelectItem>
                    <SelectItem value="court_of_appeals_decision">Court of Appeals Decision</SelectItem>
                    <SelectItem value="republic_act">Republic Act</SelectItem>
                    <SelectItem value="executive_order">Executive Order</SelectItem>
                    <SelectItem value="presidential_decree">Presidential Decree</SelectItem>
                    <SelectItem value="administrative_order">Administrative Order</SelectItem>
                    <SelectItem value="administrative_circular">Administrative Circular</SelectItem>
                    <SelectItem value="resolution">Resolution</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Court</Label>
                <Select value={court} onValueChange={setCourt}>
                  <SelectTrigger>
                    <SelectValue placeholder="All courts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All courts</SelectItem>
                    <SelectItem value="supreme_court">Supreme Court</SelectItem>
                    <SelectItem value="court_of_appeals">Court of Appeals</SelectItem>
                    <SelectItem value="sandiganbayan">Sandiganbayan</SelectItem>
                    <SelectItem value="court_of_tax_appeals">Court of Tax Appeals</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Ponente</Label>
                <Input
                  type="text"
                  value={ponente}
                  onChange={(e) => setPonente(e.target.value)}
                  placeholder="e.g., Leonen"
                />
              </div>
              <div className="space-y-2">
                <Label>G.R. Number</Label>
                <Input
                  type="text"
                  value={grNo}
                  onChange={(e) => setGrNo(e.target.value)}
                  placeholder="e.g., G.R. No. 123456"
                />
              </div>
              <div className="space-y-2">
                <Label>Date From</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Date To</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabbed Results */}
      {filters?.query && (
        <SearchTabs
          query={filters.query}
          results={results}
          meta={meta}
          isLoading={isLoading || isFetching}
          error={error instanceof Error ? error : error ? new Error(String(error)) : null}
          page={page}
          onPageChange={handlePageChange}
          documentIds={documentIds}
        />
      )}

      {searchQuota && (
        <UpgradeBanner
          variant="modal"
          corpus="search"
          quota={searchQuota}
          surface="search/results"
        />
      )}
    </div>
  );
}
