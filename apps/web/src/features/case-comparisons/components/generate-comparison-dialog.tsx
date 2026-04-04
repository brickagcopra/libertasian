'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useGenerateComparison } from '../hooks/use-case-comparisons';
import { COMPARISON_TYPE_LABELS } from '../types';
import type { ComparisonType } from '../types';
import { apiClient } from '@/lib/api-client';

interface DocumentResult {
  id: string;
  title: string;
  citationText: string | null;
  court: string | null;
  grNo: string | null;
  decisionDate: string | null;
}

interface GenerateComparisonDialogProps {
  open: boolean;
  onClose: () => void;
  matters?: { id: string; title: string }[];
}

export function GenerateComparisonDialog({
  open,
  onClose,
  matters,
}: GenerateComparisonDialogProps) {
  const router = useRouter();
  const generateComparison = useGenerateComparison();

  const [selectedDocs, setSelectedDocs] = useState<DocumentResult[]>([]);
  const [comparisonType, setComparisonType] = useState<ComparisonType>('full');
  const [matterId, setMatterId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DocumentResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const canSubmit =
    selectedDocs.length >= 2 &&
    selectedDocs.length <= 5 &&
    !generateComparison.isPending;

  const handleSearch = useCallback(async () => {
    if (searchQuery.trim().length < 2) return;
    setIsSearching(true);
    try {
      const res = await apiClient.get<{
        success: boolean;
        data: {
          id: string;
          title: string;
          citationText: string | null;
          court: string | null;
          grNo: string | null;
          decisionDate: string | null;
        }[];
      }>('/documents', {
        params: {
          search: searchQuery.trim(),
          limit: '10',
          status: 'published',
        },
      });
      setSearchResults(res.data ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSearch();
      }
    },
    [handleSearch],
  );

  const addDocument = useCallback(
    (doc: DocumentResult) => {
      if (selectedDocs.length >= 5) return;
      if (selectedDocs.some((d) => d.id === doc.id)) return;
      setSelectedDocs((prev) => [...prev, doc]);
    },
    [selectedDocs],
  );

  const removeDocument = useCallback((docId: string) => {
    setSelectedDocs((prev) => prev.filter((d) => d.id !== docId));
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      try {
        const result = await generateComparison.mutateAsync({
          documentIds: selectedDocs.map((d) => d.id),
          comparisonType,
          ...(matterId ? { matterId } : {}),
        });
        onClose();
        setSelectedDocs([]);
        setComparisonType('full');
        setMatterId('');
        setSearchQuery('');
        setSearchResults([]);
        if (result.data?.id) {
          router.push(`/workspace/comparisons/${result.data.id}`);
        }
      } catch {
        // Error is available via generateComparison.error
      }
    },
    [canSubmit, selectedDocs, comparisonType, matterId, generateComparison, onClose, router],
  );

  const handleClose = useCallback(() => {
    if (generateComparison.isPending) return;
    onClose();
    setSelectedDocs([]);
    setComparisonType('full');
    setMatterId('');
    setSearchQuery('');
    setSearchResults([]);
    generateComparison.reset();
  }, [generateComparison, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={handleClose}
        aria-hidden
      />

      <div className="relative z-10 w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">
          Compare Cases
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Select 2-5 legal documents to compare side-by-side.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Document Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Search Documents
            </label>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search by title, G.R. No., or citation..."
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
                disabled={generateComparison.isPending}
              />
              <button
                type="button"
                onClick={handleSearch}
                disabled={isSearching || searchQuery.trim().length < 2}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-md border">
              {searchResults.map((doc) => {
                const isSelected = selectedDocs.some((d) => d.id === doc.id);
                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => addDocument(doc)}
                    disabled={isSelected || selectedDocs.length >= 5}
                    className="flex w-full items-start gap-3 border-b px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">
                        {doc.title}
                      </p>
                      <p className="text-xs text-gray-500">
                        {[doc.grNo, doc.court, doc.decisionDate]
                          .filter(Boolean)
                          .join(' | ')}
                      </p>
                    </div>
                    {isSelected ? (
                      <span className="text-xs text-green-600">Selected</span>
                    ) : (
                      <span className="text-xs text-blue-600">+ Add</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Selected Documents */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Selected Documents ({selectedDocs.length}/5)
            </label>
            {selectedDocs.length === 0 ? (
              <p className="mt-1 text-sm text-gray-400">
                Search and select at least 2 documents to compare.
              </p>
            ) : (
              <div className="mt-1 space-y-1">
                {selectedDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between rounded-md border bg-gray-50 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {doc.title}
                      </p>
                      <p className="text-xs text-gray-500">
                        {doc.grNo ?? doc.citationText ?? ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDocument(doc.id)}
                      className="ml-2 text-xs text-red-500 hover:text-red-700"
                      disabled={generateComparison.isPending}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Comparison Type */}
          <div>
            <label
              htmlFor="comparison-type"
              className="block text-sm font-medium text-gray-700"
            >
              Comparison Type
            </label>
            <select
              id="comparison-type"
              value={comparisonType}
              onChange={(e) => setComparisonType(e.target.value as ComparisonType)}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
              disabled={generateComparison.isPending}
            >
              {Object.entries(COMPARISON_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Matter (optional) */}
          {matters && matters.length > 0 && (
            <div>
              <label
                htmlFor="comparison-matter"
                className="block text-sm font-medium text-gray-700"
              >
                Link to Matter{' '}
                <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <select
                id="comparison-matter"
                value={matterId}
                onChange={(e) => setMatterId(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
                disabled={generateComparison.isPending}
              >
                <option value="">None</option>
                {matters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Error */}
          {generateComparison.error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {generateComparison.error instanceof Error
                ? generateComparison.error.message
                : 'Failed to generate comparison. Please try again.'}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={generateComparison.isPending}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generateComparison.isPending ? 'Generating...' : 'Compare Cases'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
