-- Idempotency boundary for corpus-side citation extraction. Partial so
-- legacy sectionless rows (from_section_id IS NULL) aren't constrained.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_citations_section_normalized"
  ON "citations" ("from_section_id", "normalized_citation")
  WHERE "from_section_id" IS NOT NULL AND "normalized_citation" IS NOT NULL;
