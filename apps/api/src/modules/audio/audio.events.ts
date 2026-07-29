/**
 * Domain events that request audio generation.
 *
 * Publishing modules emit these instead of importing AudioModule — CLAUDE.md
 * requires domain events for cross-module communication, and a direct import
 * would create a documents -> audio -> digests cycle.
 */
export const CONTENT_PUBLISHED_EVENT = 'content.published';

/** Payload identifying the newly published item to narrate. */
export interface ContentPublishedEvent {
  readonly contentType: 'digest' | 'legal_document';
  readonly contentId: string;
  readonly language?: string;
}
