-- CreateTable
CREATE TABLE "mcq_questions" (
    "id" UUID NOT NULL,
    "derivative_artifact_id" UUID NOT NULL,
    "question_stem" TEXT NOT NULL,
    "explanation" TEXT,
    "difficulty" VARCHAR(10) NOT NULL DEFAULT 'medium',
    "question_format" VARCHAR(20) NOT NULL DEFAULT 'single_best',
    "subject_topic_id" UUID,

    CONSTRAINT "mcq_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcq_options" (
    "id" UUID NOT NULL,
    "mcq_question_id" UUID NOT NULL,
    "option_label" VARCHAR(4) NOT NULL,
    "option_text" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "rationale" TEXT,

    CONSTRAINT "mcq_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcq_questions_derivative_artifact_id_key" ON "mcq_questions"("derivative_artifact_id");

-- CreateIndex
CREATE INDEX "mcq_questions_subject_topic_id_difficulty_idx" ON "mcq_questions"("subject_topic_id", "difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "mcq_options_mcq_question_id_option_label_key" ON "mcq_options"("mcq_question_id", "option_label");

-- AddForeignKey
ALTER TABLE "mcq_questions" ADD CONSTRAINT "mcq_questions_derivative_artifact_id_fkey" FOREIGN KEY ("derivative_artifact_id") REFERENCES "derivative_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcq_options" ADD CONSTRAINT "mcq_options_mcq_question_id_fkey" FOREIGN KEY ("mcq_question_id") REFERENCES "mcq_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
