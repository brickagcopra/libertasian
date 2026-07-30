-- Classified reason a rendition failed, so a `failed` row says WHY.
--
-- Nullable and additive: existing rows keep NULL, and a rendition that later
-- succeeds has this cleared back to NULL by the upsert in
-- AudioRenditionService.generate.
ALTER TABLE "audio_renditions" ADD COLUMN "failure_reason" VARCHAR(200);
