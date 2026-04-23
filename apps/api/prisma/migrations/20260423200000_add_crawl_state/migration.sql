-- CreateTable: crawl_state tracks per-source incremental-crawl cursors so the
-- daily SCEL + LawPhil tasks can resume from the last successfully-fetched
-- decision instead of re-scanning full monthly listings every run.
--
-- Additive migration: CREATE TABLE only, no ALTERs, no FKs. source_id is a
-- UUID matching sources.id but intentionally left without a FK so a missing
-- or renamed source row never blocks the crawl task from writing state.
CREATE TABLE "crawl_state" (
  "source_id"       UUID          NOT NULL PRIMARY KEY,
  "last_crawled_at" TIMESTAMPTZ,
  "last_cursor"     TEXT,
  "updated_at"      TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
