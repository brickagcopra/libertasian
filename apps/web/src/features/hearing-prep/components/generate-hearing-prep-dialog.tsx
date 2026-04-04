'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useGenerateHearingPrep } from '../hooks/use-hearing-prep';
import { apiClient } from '@/lib/api-client';

interface DocumentResult {
  id: string;
  title: string;
  citationText: string | null;
  court: string | null;
  grNo: string | null;
  decisionDate: string | null;
}

interface GenerateHearingPrepDialogProps {
  open: boolean;
  onClose: () => void;
  matters?: { id: string; title: string }[];
}

export function GenerateHearingPrepDialog({
  open,
  onClose,
  matters,
}: GenerateHearingPrepDialogProps) {
  const router = useRouter();
  const generateHearingPrep = useGenerateHearingPrep();

  const [topic, setTopic] = useState('');
  const [issue, setIssue] = useState('');
  const [selectedDocs, setSelectedDocs] = useState<DocumentResult[]>([]);
  const [matterId, setMatterId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DocumentResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');

  const canSubmit =
    topic.trim().length >= 5 && !generateHearingPrep.isPending;

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
      const res = await generateHearingPrep.mutateAsync({
        topic: topic.trim(),
        issue: issue.trim() || undefined,
        documentIds: selectedDocs.length > 0 ? selectedDocs.map((d) => d.id) : undefined,
        matterId: matterId || undefined,
      });
      const newId = (res as { data?: { id?: string } })?.data?.id;
      if (newId) {
        router.push(`/workspace/hearing-prep/${newId}`);
      }
      onClose();
      setTopic('');
      setIssue('');
      setSelectedDocs([]);
      setMatterId('');
      setSearchQuery('');
      setSearchResults([]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate hearing prep pack',
      );
    }
  }, [canSubmit, topic, issue, selectedDocs, matterId, generateHearingPrep, router, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">
          Generate Hearing Prep Pack
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Compile relevant cases, provisions, arguments, and suggested questions for hearing preparation.
        </p>

        <div className="mt-4 space-y-4">
          {/* Topic */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Hearing Topic *
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g., Constructive dismissal under Article 297 of the Labor Code"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
              disabled={generateHearingPrep.isPending}
            />
          </div>

          {/* Issue (optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Specific Legal Issue (optional)
            </label>
            <textarea
              value={issue}
              onChange={(e) => setIssue(e.target.value)}
              placeholder="e.g., Whether the employer's act of reassigning the employee to a remote location constitutes constructive dismissal..."
              rows={3}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
              disabled={generateHearingPrep.isPending}
            />
          </div>

          {/* Document search (optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Related Documents (optional)
            </label>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search for documents to include..."
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
                disabled={generateHearingPrep.isPending}
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
                Selected ({selectedDocs.length}):
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
                disabled={generateHearingPrep.isPending}
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
            disabled={generateHearingPrep.isPending}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {generateHearingPrep.isPending ? 'Generating...' : 'Generate Pack'}
          </button>
        </div>
      </div>
    </div>
  );
}
