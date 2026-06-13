'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useGenerateMemo } from '../hooks/use-memos';
import { MEMO_TYPE_LABELS } from '../types';

interface GenerateMemoDialogProps {
  open: boolean;
  onClose: () => void;
  matters?: { id: string; title: string }[];
}

export function GenerateMemoDialog({
  open,
  onClose,
  matters,
}: GenerateMemoDialogProps) {
  const router = useRouter();
  const generateMemo = useGenerateMemo();

  const [query, setQuery] = useState('');
  const [memoType, setMemoType] = useState('legal_opinion');
  const [matterId, setMatterId] = useState('');

  const canSubmit = query.trim().length >= 10 && !generateMemo.isPending;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      try {
        const result = await generateMemo.mutateAsync({
          query: query.trim(),
          memoType,
          ...(matterId ? { matterId } : {}),
        });
        onClose();
        setQuery('');
        setMemoType('legal_opinion');
        setMatterId('');
        // Navigate to the newly created memo
        if (result.data?.id) {
          router.push(`/workspace/memos/${result.data.id}`);
        }
      } catch {
        // Error is available via generateMemo.error
      }
    },
    [canSubmit, query, memoType, matterId, generateMemo, onClose, router],
  );

  const handleClose = useCallback(() => {
    if (generateMemo.isPending) return;
    onClose();
    setQuery('');
    setMemoType('legal_opinion');
    setMatterId('');
    generateMemo.reset();
  }, [generateMemo, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={handleClose}
        aria-hidden
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">
          Generate Legal Memo
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Describe your research question and the AI will generate a structured
          legal memo with citations.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Query */}
          <div>
            <label
              htmlFor="memo-query"
              className="block text-sm font-medium text-gray-700"
            >
              Research Question
            </label>
            <textarea
              id="memo-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g., What are the legal requirements for constructive dismissal under Philippine labor law?"
              rows={4}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
              maxLength={2000}
              disabled={generateMemo.isPending}
            />
            <p className="mt-1 text-xs text-gray-400">
              {query.length}/2000 characters (minimum 10)
            </p>
          </div>

          {/* Memo Type */}
          <div>
            <label
              htmlFor="memo-type"
              className="block text-sm font-medium text-gray-700"
            >
              Memo Type
            </label>
            <select
              id="memo-type"
              value={memoType}
              onChange={(e) => setMemoType(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
              disabled={generateMemo.isPending}
            >
              {Object.entries(MEMO_TYPE_LABELS).map(([value, label]) => (
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
                htmlFor="memo-matter"
                className="block text-sm font-medium text-gray-700"
              >
                Link to Matter{' '}
                <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <select
                id="memo-matter"
                value={matterId}
                onChange={(e) => setMatterId(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
                disabled={generateMemo.isPending}
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
          {generateMemo.error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {generateMemo.error instanceof Error
                ? generateMemo.error.message
                : 'Failed to generate memo. Please try again.'}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={generateMemo.isPending}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generateMemo.isPending ? 'Generating...' : 'Generate Memo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
