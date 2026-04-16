-- CreateIndex
CREATE UNIQUE INDEX "uq_digest_document_type" ON "digests"("legal_document_id", "digest_type");
