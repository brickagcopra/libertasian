'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useGenerateTimeline } from '../hooks/use-timelines';
import { apiClient } from '@/lib/api-client';

interface DocumentResult {
  id: string;
  title: string;
  citationText: string | null;
  court: string | null;
  grNo: string | null;
  decisionDate: string | null;
}

interface GenerateTimelineDialogProps {
  open: boolean;
  onClose: () => void;
  matters?: { id: string; title: string }[];
}

export function GenerateTimelineDialog({
  open,
  onClose,
  matters,
}: GenerateTimelineDialogProps) {
  const router = useRouter();
  const generateTimeline = useGenerateTimeline();

  const [title, setTitle] = useState('');
  const [selectedDocs, setSelectedDocs] = useState<DocumentResult[]>([]);
  const [matterId, setMatterId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DocumentResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');

  const canSubmit =
    title.trim().length >= 3 &&
    selectedDocs.length >= 1 &&
    selectedDocs.length <= 10 &&
    !generateTimeline.isPending;

  const handleSearch = useCallback(async () => {
    if (searchQuery.trim().length < 2) return;
    setIsSearching(true);
    try {
      const res = await apiClient.get<{
        success: boolean;
        data: DocumentResult[];
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
      if (selectedDocs.length >= 10) return;
      if (selectedDocs.some((d) => d.id === doc.id)) return;
      setSelectedDocs((prev) => [...prev, doc]);
    },
    [selectedDocs],
  );

  const removeDocument = useCallback((docId: string) => {
    setSelectedDocs((prev) => prev.filter((d) => d.id !== docId));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setError('');
    try {
      const res = await generateTimeline.mutateAsync({
        title: title.trim(),
        documentIds: selectedDocs.map((d) => d.id),
        matterId: matterId || undefined,
      });
      const newId = (res as { data?: { id?: string } })?.data?.id;
      if (newId) {
        router.push(`/workspace/timelines/${newId}`);
      }
      onClose();
      setTitle('');
      setSelectedDocs([]);
      setMatterId('');
      setSearchQuery('');
      setSearchResults([]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate timeline',
      );
    }
  }, [canSubmit, title, selectedDocs, matterId, generateTimeline, router, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="mx-4 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">
          Generate Timeline
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Extract chronological events from legal documents.
        </p>

        <div className="mt-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Timeline Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Reyes v. Santos Case History"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
              disabled={generateTimeline.isPending}
            />
          </div>

          {/* Document search */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Documents (1-10) *
            </label>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search for legal documents..."
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
                disabled={generateTimeline.isPending}
              />
              <button
                onClick={handleSearch}
                disabled={isSearching || searchQuery.trim().length < 2}
                className="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-50"
              >
                {isSearching ? '...' : 'Search'}
              </button>
            </div>
          </div>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border bg-gray-50 p-2">
              {searchResults.map((doc) => {
                const isSelected = selectedDocs.some((d) => d.id === doc.id);
                return (
                  <button
                    key={doc.id}
                    onClick={() => addDocument(doc)}
                    disabled={isSelected || selectedDocs.length >= 10}
                    className="block w-full rounded p-2 text-left text-sm hover:bg-white disabled:opacity-50"
                  >
                    <p className="font-medium text-gray-900 line-clamp-1">
                      {doc.title}
                    </p>
                    <p className="text-xs text-gray-500">
                      {[doc.citationText, doc.court]
                        .filter(Boolean)
                        .join(' - ')}
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {/* Selected documents */}
          {selectedDocs.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-600">
                Selected ({selectedDocs.length}/10):
              </p>
              {selectedDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between rounded-md border bg-blue-50 px-3 py-1.5"
                >
                  <span className="text-sm text-blue-900 line-clamp-1">
                    {doc.title}
                  </span>
                  <button
                    onClick={() => removeDocument(doc.id)}
                    className="ml-2 text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Matter (optional) */}
          {matters && matters.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Link to Matter (optional)
              </label>
              <select
                value={matterId}
                onChange={(e) => setMatterId(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
                disabled={generateTimeline.isPending}
              >
                <option value="">No matter</option>
                {matters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={generateTimeline.isPending}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {generateTimeline.isPending ? 'Generating...' : 'Generate Timeline'}
          </button>
        </div>
      </div>
    </div>
  );
}
