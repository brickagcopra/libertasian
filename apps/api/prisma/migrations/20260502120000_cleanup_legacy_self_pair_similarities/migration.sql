-- Cleanup: remove legacy self-pair rows in document_similarities.
--
-- Background: prior to PR #105 (commit 0fed42d, "stop writing self-pair
-- similarity rows"), the dedup writer could produce rows where
-- document_a_id = document_b_id. PR #105 added a writer-side guard so
-- new rows can no longer have this shape. The pre-PR-#105 rows remain
-- in the table and pollute the suppressed-docs query (a self-pair would
-- otherwise mark a canonical document as its own duplicate).
--
-- Safe to run idempotently — the WHERE clause is empty after the first
-- successful application.
DELETE FROM document_similarities
WHERE document_a_id = document_b_id;
