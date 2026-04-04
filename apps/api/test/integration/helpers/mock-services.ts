/**
 * Mock service response factories for integration tests.
 * These provide realistic response shapes matching the Python service contracts.
 */

import type { QualityScoreResult, OcrExtractResult, ClassificationResult, CitationExtractionResult, PdfExtractResult } from '../../../src/modules/uploads/ocr-client.service';
import type { AiAnswerResponse } from '../../../src/modules/ai-answers/ai-answers.service';

// ─── OCR Service Mocks ─────────────────────────────────────────────────────

export function mockQualityScore(overrides?: Partial<QualityScoreResult>): QualityScoreResult {
  return {
    overallScore: 0.85,
    metrics: { blur: 0.9, resolution: 0.8, contrast: 0.85, brightness: 0.82 },
    isAcceptable: true,
    needsWarning: false,
    recommendation: 'Image quality is acceptable.',
    ...overrides,
  };
}

export function mockQualityScoreReject(): QualityScoreResult {
  return mockQualityScore({
    overallScore: 0.15,
    metrics: { blur: 0.1, resolution: 0.2, contrast: 0.15, brightness: 0.1 },
    isAcceptable: false,
    needsWarning: true,
    recommendation: 'Image is too blurry. Please retake in better lighting.',
  });
}

export function mockQualityScoreWarn(): QualityScoreResult {
  return mockQualityScore({
    overallScore: 0.35,
    metrics: { blur: 0.3, resolution: 0.4, contrast: 0.35, brightness: 0.3 },
    isAcceptable: true,
    needsWarning: true,
    recommendation: 'Image quality is marginal. Consider retaking for better results.',
  });
}

export function mockOcrExtract(overrides?: Partial<OcrExtractResult>): OcrExtractResult {
  return {
    text: 'REPUBLIC OF THE PHILIPPINES\nSUPREME COURT\nManila\n\nG.R. No. 123456\n\nPEOPLE OF THE PHILIPPINES, plaintiff-appellee, vs. JUAN DELA CRUZ, accused-appellant.\n\nDECISION\n\nThe Court finds the accused guilty beyond reasonable doubt...',
    confidence: 0.92,
    wordCount: 42,
    languageDetected: 'eng',
    ...overrides,
  };
}

export function mockClassification(overrides?: Partial<ClassificationResult>): ClassificationResult {
  return {
    documentType: 'case_decision',
    confidence: 0.88,
    ...overrides,
  };
}

export function mockCitationExtraction(overrides?: Partial<CitationExtractionResult>): CitationExtractionResult {
  return {
    citations: ['G.R. No. 123456', 'G.R. No. 789012'],
    normalizedCitations: ['G.R. No. 123456', 'G.R. No. 789012'],
    ...overrides,
  };
}

export function mockPdfExtract(overrides?: Partial<PdfExtractResult>): PdfExtractResult {
  return {
    pages: [
      { pageNumber: 1, text: 'Page 1 content about legal matters...', wordCount: 150, isOcr: false },
      { pageNumber: 2, text: 'Page 2 continuation of the decision...', wordCount: 200, isOcr: false },
    ],
    totalText: 'Page 1 content about legal matters...\nPage 2 continuation of the decision...',
    totalWordCount: 350,
    totalPages: 2,
    confidence: 0.95,
    languageDetected: 'eng',
    hasTextLayer: true,
    ...overrides,
  };
}

// ─── RAG Service Mocks ─────────────────────────────────────────────────────

export function mockRagDigestResponse(overrides?: Record<string, unknown>) {
  return {
    summary: 'The Supreme Court ruled on the legality of constructive dismissal.',
    facts: 'The petitioner was employed by respondent company for 10 years before being forced to resign.',
    petitioner_arguments: 'Petitioner argues constructive dismissal due to demotion and hostile work environment.',
    respondent_arguments: 'Respondent contends the resignation was voluntary.',
    issues: 'Whether the petitioner was constructively dismissed from employment.',
    ruling: 'The Court finds in favor of petitioner. Constructive dismissal is established.',
    doctrine: 'Constructive dismissal exists when continued employment becomes impossible or unreasonable.',
    dispositive: 'WHEREFORE, the petition is GRANTED. Respondent is ordered to pay back wages.',
    provenance: [
      { field: 'facts', source_section_id: 'section-1', source_document_id: 'doc-1' },
      { field: 'issues', source_section_id: 'section-2', source_document_id: 'doc-1' },
      { field: 'ruling', source_section_id: 'section-3', source_document_id: 'doc-1' },
      { field: 'doctrine', source_section_id: 'section-3', source_document_id: 'doc-1' },
      { field: 'dispositive', source_section_id: 'section-4', source_document_id: 'doc-1' },
    ],
    confidence_score: 0.85,
    model_name: 'test-model-v1',
    prompt_template_version: 'digest-v2.1',
    ...overrides,
  };
}

export function mockRagDigestLowConfidence() {
  return mockRagDigestResponse({
    confidence_score: 0.55,
    facts: 'Partial extraction - some sections unclear.',
    issues: null,
  });
}

export function mockRagAnswerResponse(overrides?: Partial<AiAnswerResponse>): AiAnswerResponse {
  return {
    answer: 'Based on the doctrine of constructive dismissal established in Philippine jurisprudence, an employee who is forced to resign due to untenable working conditions is deemed constructively dismissed.',
    sources: [
      {
        document_id: 'doc-1',
        title: 'People v. Dela Cruz',
        citation_text: 'G.R. No. 123456',
        court: 'Supreme Court',
        relevance_score: 0.95,
        passage_text: 'Constructive dismissal exists when continued employment becomes impossible...',
      },
      {
        document_id: 'doc-2',
        title: 'Santos v. ABC Corp',
        citation_text: 'G.R. No. 789012',
        court: 'Court of Appeals',
        relevance_score: 0.82,
        passage_text: 'The test of constructive dismissal is whether a reasonable person...',
      },
    ],
    confidence: 0.88,
    abstained: false,
    model_name: 'test-model-v1',
    model_version: '2024.01',
    prompt_template_version: 'answer-v3.0',
    tokens_in: 2048,
    tokens_out: 512,
    latency_ms: 1500,
    ...overrides,
  };
}

export function mockRagAnswerAbstained(): AiAnswerResponse {
  return mockRagAnswerResponse({
    answer: '',
    sources: [],
    confidence: 0.15,
    abstained: true,
    abstention_reason: 'Insufficient relevant passages found to provide a reliable answer.',
    tokens_in: 1024,
    tokens_out: 32,
    latency_ms: 400,
  });
}

// ─── Upload Digest RAG Response ────────────────────────────────────────────

export function mockUploadDigestRagResponse(overrides?: Record<string, unknown>) {
  return {
    facts: 'The case involves a labor dispute regarding illegal dismissal.',
    issues: 'Whether the termination was valid under the Labor Code.',
    ruling: 'The Court rules in favor of the employee.',
    doctrine: 'Illegal dismissal requires reinstatement and full backwages.',
    dispositive: 'WHEREFORE, the petition is GRANTED.',
    confidence_score: 0.78,
    model_name: 'test-model-v1',
    prompt_template_version: 'upload-digest-v1.0',
    ...overrides,
  };
}

// ─── ClamAV Mocks ──────────────────────────────────────────────────────────

export function mockClamavClean() {
  return { clean: true };
}

export function mockClamavInfected(virus = 'Eicar-Test-Signature') {
  return { clean: false, virus };
}

// ─── Embedding Service Mocks ───────────────────────────────────────────────

export function mockEmbeddingVector(dimension = 1024): number[] {
  return Array.from({ length: dimension }, () => Math.random() * 2 - 1);
}

export function mockEmbeddingBatch(count: number, dimension = 1024): number[][] {
  return Array.from({ length: count }, () => mockEmbeddingVector(dimension));
}
