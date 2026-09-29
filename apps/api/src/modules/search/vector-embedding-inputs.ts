/**
 * The single definition of WHAT gets embedded into `legal_documents_vector`
 * and under WHICH `_id`.
 *
 * This file exists because the vector index was 18.6% populated in prod
 * (2026-09-02: 16,182 chunks across ~3,347 documents against 90,008 keyword
 * chunks across ~17,955) and the fix is a backfill. A backfill that re-derives
 * "which text, truncated where, under which id" on its own would produce a
 * second population inside one index — chunks that answer the same query
 * differently depending on which code path happened to write them. That is the
 * same bug class that produced `statute`/`code`/`rule` and
 * `embedding`/`embedding_vector`.
 *
 * So both the live path (`SearchService.indexLegalDocument`) and the backfill
 * (`VectorBackfillService`) call `buildVectorEmbeddingInputs` and nothing else.
 * Changing a rule here changes both, which is the point.
 */

import type { IndexDocumentPayload, VectorDocumentPayload } from './opensearch.service';
import { chunkSection, indexRowId } from './section-chunks';

/**
 * Hard ceiling on the characters handed to the embedding service. The model
 * truncates at its own context window anyway; this bounds the request body and
 * keeps batch latency predictable.
 */
export const MAX_EMBEDDING_TEXT_LENGTH = 16_000;

/**
 * Sections shorter than this are not embedded. A 40-character section is a
 * heading or a stray line-break artifact: it embeds to a near-meaningless
 * point that competes with real passages in kNN.
 */
export const MIN_SECTION_TEXT_LENGTH = 50;

/** Characters of source text stored alongside the vector for display. */
export const SNIPPET_LENGTH = 500;

/** One unit of embedding work: exactly one document in the vector index. */
export interface VectorEmbeddingInput {
  documentId: string;
  /** Absent for the document-level (whole-text) vector. */
  sectionId?: string;
  /**
   * Set for one chunk of a long section (see `section-chunks.ts`): its
   * position and its offsets into the section's `plainText`.
   */
  chunk?: { index: number; charStart: number; charEnd: number };
  /** The text handed to the embedding service, already truncated. */
  text: string;
  /**
   * Stored on the vector document for result display. For a chunk it is the
   * whole chunk text, so kNN hands downstream the passage it matched on.
   */
  snippet: string;
}

/** The document shape `buildVectorEmbeddingInputs` needs. */
export interface VectorEmbeddingSource {
  id: string;
  title: string;
  sections: { id: string; plainText: string | null }[];
}

/**
 * The vector index `_id`.
 *
 * `indexRowId` — the same function `indexVectorDocument` and
 * `bulkIndexVectorDocuments` use: `{sectionId}:c{n}` for a chunk, else
 * `section_id ?? document_id`. Because it is derived from the row's own
 * identity rather than allocated, every write is an idempotent overwrite: the
 * backfill is safe to run twice and resumable by construction.
 */
export function vectorDocumentId(input: {
  documentId: string;
  sectionId?: string;
  chunk?: { index: number };
}): string {
  return indexRowId({
    document_id: input.documentId,
    section_id: input.sectionId,
    chunk_index: input.chunk?.index,
  });
}

/**
 * Every vector chunk a document should have, in stable order: the
 * document-level vector first, then one per qualifying section — or, for a
 * section long enough that `chunkSection` splits it, one per chunk.
 *
 * `fullText` is the sections' `plainText` joined by a blank line — passed in
 * rather than recomputed because the live path already built it for the
 * keyword index.
 */
export function buildVectorEmbeddingInputs(
  document: VectorEmbeddingSource,
  fullText: string,
): VectorEmbeddingInput[] {
  const inputs: VectorEmbeddingInput[] = [];

  // Document-level embedding (title + truncated full text).
  if (fullText.length > 0) {
    inputs.push({
      documentId: document.id,
      text: `${document.title}\n\n${fullText}`.slice(0, MAX_EMBEDDING_TEXT_LENGTH),
      snippet: fullText.slice(0, SNIPPET_LENGTH),
    });
  }

  // Section-level embeddings.
  for (const section of document.sections) {
    if (!section.plainText || section.plainText.length < MIN_SECTION_TEXT_LENGTH) {
      continue;
    }
    const chunks = chunkSection(section.plainText);
    if (chunks.length > 0) {
      for (const chunk of chunks) {
        inputs.push({
          documentId: document.id,
          sectionId: section.id,
          chunk: {
            index: chunk.index,
            charStart: chunk.charStart,
            charEnd: chunk.charEnd,
          },
          text: chunk.text,
          snippet: chunk.text,
        });
      }
      continue;
    }
    inputs.push({
      documentId: document.id,
      sectionId: section.id,
      text: section.plainText.slice(0, MAX_EMBEDDING_TEXT_LENGTH),
      snippet: section.plainText.slice(0, SNIPPET_LENGTH),
    });
  }

  return inputs;
}

/** The sections' text joined the way the keyword index joins it. */
export function joinSectionText(
  sections: { plainText: string | null }[],
): string {
  return sections
    .map((s) => s.plainText)
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The metadata half of a vector document — everything except the embedding.
 * Kept as a distinct type so the backfill can assemble it from a plain Prisma
 * row without first building a full keyword `IndexDocumentPayload`.
 */
export type VectorPayloadBase = Omit<
  VectorDocumentPayload,
  'document_id' | 'section_id' | 'embedding_vector' | 'text_snippet'
>;

/** Narrow a keyword payload to the fields the vector index carries. */
export function toVectorPayloadBase(
  basePayload: Pick<
    IndexDocumentPayload,
    | 'document_type'
    | 'court'
    | 'source_trust_level'
    | 'is_official'
    | 'is_published'
    | 'decision_date'
    | 'title'
    | 'citation_text'
  >,
): VectorPayloadBase {
  return {
    document_type: basePayload.document_type,
    court: basePayload.court,
    source_trust_level: basePayload.source_trust_level,
    is_official: basePayload.is_official,
    is_published: basePayload.is_published,
    decision_date: basePayload.decision_date,
    title: basePayload.title,
    citation_text: basePayload.citation_text,
  };
}

/** Assemble the document written to the vector index. */
export function toVectorDocumentPayload(
  input: VectorEmbeddingInput,
  base: VectorPayloadBase,
  embedding: number[],
): VectorDocumentPayload {
  return {
    ...base,
    document_id: input.documentId,
    section_id: input.sectionId,
    ...(input.chunk && {
      chunk_index: input.chunk.index,
      char_start: input.chunk.charStart,
      char_end: input.chunk.charEnd,
    }),
    embedding_vector: embedding,
    text_snippet: input.snippet,
  };
}
