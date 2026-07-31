/**
 * Which documents are narrated per SECTION rather than as one file.
 *
 * The API decides this by `document_type`, not by id: its reconciler tier 4
 * covers `CODAL_DOCUMENT_TYPES` (`apps/api/src/modules/audio/audio.types.ts`),
 * which is every statutory document — 24 published, 7,661 sections. This list
 * mirrors that one. It is deliberately NOT a list of the four large documents
 * that motivated the feature: hardcoding ids would go stale the moment a
 * twenty-fifth statute is published, and would be wrong for the twenty other
 * statutes that are already sectioned today.
 *
 * Keep in sync with the API constant. A type that drifts out of this list only
 * hides the controls; it can never produce a broken player, because the reader
 * still degrades to "preparing" for any section whose rendition is not ready.
 */
export const SECTION_NARRATED_DOCUMENT_TYPES = [
  'codal',
  'constitution',
  'republic_act',
  'presidential_decree',
  'executive_order',
  'rules_of_court',
] as const;

/**
 * Whether this document's sections have their own audio renditions.
 *
 * Derived from the document's own `documentType` as returned by
 * `GET /documents/:id`. Decisions are narrated whole and answer `false`.
 */
export function hasSectionAudio(documentType: string | null | undefined): boolean {
  if (!documentType) return false;
  return (SECTION_NARRATED_DOCUMENT_TYPES as readonly string[]).includes(
    documentType,
  );
}

/** A section, reduced to what the play chain needs. */
export interface PlayableSection {
  id: string;
  ordering?: number;
}

/**
 * The play queue for "Play whole document": section ids in `ordering` sequence,
 * DE-DUPLICATED.
 *
 * The dedupe is not theoretical hygiene. `handleEnded` walks the queue by
 * `indexOf(currentId)`, so a repeated id makes `indexOf` return the FIRST
 * occurrence forever and the chain can bounce between two positions without
 * ever reaching the end — an infinite 2-cycle. Removing duplicates here plus
 * the `nextId !== currentId` guard at the advance site makes that unreachable
 * from either direction.
 */
export function buildSectionQueue(
  sections: readonly PlayableSection[] | null | undefined,
): string[] {
  if (!sections || sections.length === 0) return [];
  const ordered = [...sections].sort(
    (a, b) => (a.ordering ?? 0) - (b.ordering ?? 0),
  );
  return [...new Set(ordered.map((section) => section.id))];
}
