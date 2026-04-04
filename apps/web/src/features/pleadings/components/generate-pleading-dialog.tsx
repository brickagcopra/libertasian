'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  usePleadingTemplates,
  usePleadingTemplate,
  useGeneratePleading,
} from '../hooks/use-pleadings';
import { PLEADING_CATEGORY_LABELS } from '../types';
import type { PleadingTemplateSection } from '../types';

interface GeneratePleadingDialogProps {
  open: boolean;
  onClose: () => void;
  matters?: { id: string; title: string }[];
}

export function GeneratePleadingDialog({
  open,
  onClose,
  matters,
}: GeneratePleadingDialogProps) {
  const router = useRouter();
  const generatePleading = useGeneratePleading();

  const [step, setStep] = useState<'template' | 'form'>('template');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [contextQuery, setContextQuery] = useState('');
  const [matterId, setMatterId] = useState('');

  const { data: templatesData, isLoading: templatesLoading } = usePleadingTemplates(
    categoryFilter || undefined,
  );
  const templates = templatesData?.data ?? [];

  const { data: selectedTemplate } = usePleadingTemplate(selectedTemplateId);

  const sections = selectedTemplate?.templateJson?.sections ?? [];

  const canSubmit = (() => {
    if (!selectedTemplateId || generatePleading.isPending) return false;
    for (const section of sections) {
      if (section.required && !formData[section.key]?.trim()) return false;
    }
    return true;
  })();

  const handleSelectTemplate = useCallback((templateId: string) => {
    setSelectedTemplateId(templateId);
    setFormData({});
    setStep('form');
  }, []);

  const handleFieldChange = useCallback((key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit || !selectedTemplateId) return;

      try {
        const result = await generatePleading.mutateAsync({
          templateId: selectedTemplateId,
          inputData: formData,
          ...(contextQuery.trim().length >= 5 ? { contextQuery: contextQuery.trim() } : {}),
          ...(matterId ? { matterId } : {}),
        });
        handleClose();
        if (result.data?.id) {
          router.push(`/workspace/pleadings/${result.data.id}`);
        }
      } catch {
        // Error is available via generatePleading.error
      }
    },
    [canSubmit, selectedTemplateId, formData, contextQuery, matterId, generatePleading, router],
  );

  const handleClose = useCallback(() => {
    if (generatePleading.isPending) return;
    onClose();
    setStep('template');
    setSelectedTemplateId(null);
    setFormData({});
    setContextQuery('');
    setMatterId('');
    setCategoryFilter('');
    generatePleading.reset();
  }, [generatePleading, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={handleClose}
        aria-hidden
      />

      <div className="relative z-10 w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        {step === 'template' ? (
          /* Step 1: Template Selection */
          <>
            <h2 className="text-lg font-semibold text-gray-900">
              Select Pleading Template
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Choose a template to get started with AI-assisted pleading
              drafting.
            </p>

            {/* Category filter */}
            <div className="mt-4">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
              >
                <option value="">All Categories</option>
                {Object.entries(PLEADING_CATEGORY_LABELS).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </div>

            {/* Templates list */}
            {templatesLoading && (
              <div className="mt-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-md bg-gray-100"
                  />
                ))}
              </div>
            )}

            {!templatesLoading && templates.length === 0 && (
              <div className="mt-4 rounded-md border-2 border-dashed p-6 text-center text-sm text-gray-500">
                No templates found for this category.
              </div>
            )}

            {!templatesLoading && templates.length > 0 && (
              <div className="mt-4 space-y-2">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => handleSelectTemplate(template.id)}
                    className="flex w-full items-start gap-3 rounded-md border p-3 text-left hover:bg-gray-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">
                        {template.name}
                      </p>
                      {template.description && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          {template.description}
                        </p>
                      )}
                      <div className="mt-1 flex gap-2">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                          {PLEADING_CATEGORY_LABELS[template.category] ??
                            template.category}
                        </span>
                        {template.court && (
                          <span className="text-xs text-gray-400">
                            {template.court}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-blue-600">Select &rarr;</span>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          /* Step 2: Form */
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep('template')}
                className="text-sm text-gray-500 hover:text-gray-700"
                disabled={generatePleading.isPending}
              >
                &larr; Back
              </button>
              <h2 className="text-lg font-semibold text-gray-900">
                {selectedTemplate?.name ?? 'Pleading Details'}
              </h2>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Fill in the details below to generate your pleading.
            </p>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {/* Dynamic template fields */}
              {sections.map((section) => (
                <TemplateField
                  key={section.key}
                  section={section}
                  value={formData[section.key] ?? ''}
                  onChange={(val) => handleFieldChange(section.key, val)}
                  disabled={generatePleading.isPending}
                />
              ))}

              {/* Context query (optional) */}
              <div>
                <label
                  htmlFor="pleading-context"
                  className="block text-sm font-medium text-gray-700"
                >
                  Additional Context{' '}
                  <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <textarea
                  id="pleading-context"
                  value={contextQuery}
                  onChange={(e) => setContextQuery(e.target.value)}
                  placeholder="e.g., Strengthen arguments about breach of contract..."
                  rows={2}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
                  maxLength={2000}
                  disabled={generatePleading.isPending}
                />
              </div>

              {/* Matter (optional) */}
              {matters && matters.length > 0 && (
                <div>
                  <label
                    htmlFor="pleading-matter"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Link to Matter{' '}
                    <span className="font-normal text-gray-400">
                      (optional)
                    </span>
                  </label>
                  <select
                    id="pleading-matter"
                    value={matterId}
                    onChange={(e) => setMatterId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
                    disabled={generatePleading.isPending}
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
              {generatePleading.error && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                  {generatePleading.error instanceof Error
                    ? generatePleading.error.message
                    : 'Failed to generate pleading. Please try again.'}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={generatePleading.isPending}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generatePleading.isPending
                    ? 'Generating...'
                    : 'Generate Pleading'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function TemplateField({
  section,
  value,
  onChange,
  disabled,
}: {
  section: PleadingTemplateSection;
  value: string;
  onChange: (val: string) => void;
  disabled: boolean;
}) {
  const labelEl = (
    <label
      htmlFor={`field-${section.key}`}
      className="block text-sm font-medium text-gray-700"
    >
      {section.label}
      {!section.required && (
        <span className="ml-1 font-normal text-gray-400">(optional)</span>
      )}
    </label>
  );

  const description = section.description ? (
    <p className="mt-0.5 text-xs text-gray-400">{section.description}</p>
  ) : null;

  switch (section.inputType) {
    case 'textarea':
    case 'party_list':
      return (
        <div>
          {labelEl}
          {description}
          <textarea
            id={`field-${section.key}`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            disabled={disabled}
            placeholder={
              section.inputType === 'party_list'
                ? 'Enter party names, one per line'
                : undefined
            }
          />
        </div>
      );
    case 'select':
      return (
        <div>
          {labelEl}
          {description}
          <select
            id={`field-${section.key}`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            disabled={disabled}
          >
            <option value="">Select...</option>
            {(section.options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );
    case 'date':
      return (
        <div>
          {labelEl}
          {description}
          <input
            id={`field-${section.key}`}
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            disabled={disabled}
          />
        </div>
      );
    case 'text':
    default:
      return (
        <div>
          {labelEl}
          {description}
          <input
            id={`field-${section.key}`}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            disabled={disabled}
          />
        </div>
      );
  }
}
