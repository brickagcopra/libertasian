/**
 * Mobile search filter chips and result badges, derived from the shared
 * `DOCUMENT_TYPE_GROUPS` so they can never drift from what the API accepts or
 * from what the corpus actually holds.
 *
 * Before this, the chips sent the legacy abstract values (`case`, `statute`,
 * `article`, `outline`). The DTO accepts them, so there was no 400 to notice —
 * but production has zero rows of any of them, so every chip except "All"
 * emptied the results list, and every decision rendered as ARTICLE.
 */
import {
  DOCUMENT_TYPE_GROUPS,
  DOCUMENT_TYPE_LABELS,
  type DocumentTypeValue,
} from '@libertasian/types';
import type { SearchResultKind } from '@/components/screens/SearchScreen';

/** Chip labels in display order. */
export const SEARCH_FILTER_LABELS: string[] = DOCUMENT_TYPE_GROUPS.map(
  (group) => group.label,
);

export const DEFAULT_SEARCH_FILTER_LABEL = SEARCH_FILTER_LABELS[0] ?? 'All';

function typesForLabel(label: string): readonly DocumentTypeValue[] {
  return DOCUMENT_TYPE_GROUPS.find((group) => group.label === label)?.types ?? [];
}

function typeSetForLabel(label: string): ReadonlySet<string> {
  return new Set<string>(typesForLabel(label));
}

const STATUTE_TYPES = typeSetForLabel('Statutes');
const RULE_TYPES = typeSetForLabel('Rules');

/**
 * The `documentType` fragment to spread into the search body for a chip.
 * "All" (and any unknown label) yields `{}` so the key is omitted entirely —
 * the API treats an absent filter and an empty array differently.
 */
export function documentTypeFilter(
  label: string,
): { documentType?: string[] } {
  const types = typesForLabel(label);
  return types.length > 0 ? { documentType: [...types] } : {};
}

/** Badge class for a concrete `legal_documents.document_type`. */
export function kindFor(documentType: string): SearchResultKind {
  if (documentType === 'decision' || RULE_TYPES.has(documentType)) return 'CASE';
  if (STATUTE_TYPES.has(documentType)) return 'STATUTE';
  return 'ARTICLE';
}

/**
 * Badge text: the human label for the document type, uppercased. Falls back to
 * the coarse kind when the corpus surfaces a type we have no label for.
 */
export function kindLabelFor(documentType: string): string {
  const label = (DOCUMENT_TYPE_LABELS as Record<string, string | undefined>)[
    documentType
  ];
  return label ? label.toUpperCase() : kindFor(documentType);
}
