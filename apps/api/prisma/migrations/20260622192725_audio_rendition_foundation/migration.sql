-- CreateTable: audio_renditions (Audio Corpus — Phase 1 Foundation)
-- One row per synthesized TTS rendition of a short legal content item
-- (digest | bar_exam_answer) for a given language + voice. Audio + speech
-- marks live in object storage; only the keys are persisted here.
CREATE TABLE "audio_renditions" (
    "id" UUID NOT NULL,
    "content_type" VARCHAR(30) NOT NULL,
    "content_id" VARCHAR(255) NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "voice_id" VARCHAR(50) NOT NULL,
    "engine" VARCHAR(30) NOT NULL DEFAULT 'polly',
    "audio_object_key" VARCHAR(500) NOT NULL,
    "marks_object_key" VARCHAR(500),
    "duration_ms" INTEGER,
    "char_count" INTEGER,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "visibility" VARCHAR(30) NOT NULL DEFAULT 'public_editorial',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audio_renditions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "audio_renditions_content_type_content_id_language_voice_id_key" ON "audio_renditions"("content_type", "content_id", "language", "voice_id");

-- CreateIndex
CREATE INDEX "audio_renditions_content_hash_idx" ON "audio_renditions"("content_hash");
