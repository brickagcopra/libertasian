-- Backfill study_8 subject assignments for approved+public flashcard artifacts
-- that have none, inheriting from the source legal_document. Idempotent + re-runnable.
INSERT INTO document_subject_assignments
  (id, derivative_artifact_id, subject_id, subject_topic_id, is_primary,
   confidence, classified_by, manual_override, created_at, updated_at)
SELECT gen_random_uuid(), da.id, p.subject_id, p.subject_topic_id, p.is_primary,
       NULL, 'manual', false, now(), now()
FROM derivative_artifacts da
JOIN document_subject_assignments p
  ON p.legal_document_id = da.source_document_id
JOIN subjects s
  ON s.id = p.subject_id AND s.taxonomy_version = 'study_8'
WHERE da.derivative_type = 'flashcard'
  AND da.review_status = 'approved'
  AND da.visibility = 'public_editorial'
  AND da.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM document_subject_assignments x
    WHERE x.derivative_artifact_id = da.id
  )
ON CONFLICT (derivative_artifact_id, subject_id, subject_topic_id) DO NOTHING;
