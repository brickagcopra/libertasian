-- Add the segment read-along manifest object key to audio_renditions.
-- Additive + nullable: existing rows keep NULL until their next (re)synthesis,
-- at which point the read-along manifest JSON is generated and its S3 key stored
-- here. No backfill required; the read endpoint returns a signed readalong URL
-- only when this column is set.
ALTER TABLE "audio_renditions" ADD COLUMN "readalong_object_key" VARCHAR(500);
