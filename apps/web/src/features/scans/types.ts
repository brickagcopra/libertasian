export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type OcrStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type PrivacyLevel = 'private' | 'editorial_candidate';

export interface ScanListItem {
  id: string;
  uploadType: string;
  originalFilename: string | null;
  mimeType: string | null;
  processingStatus: ProcessingStatus;
  ocrStatus: OcrStatus;
  privacyLevel: PrivacyLevel;
  pageCount: number | null;
  createdAt: string;
}

export interface ScanListMeta {
  hasNext: boolean;
  nextCursor: string | null;
}

export interface ScanListResponse {
  success: boolean;
  data: ScanListItem[];
  meta: ScanListMeta;
}

export interface ProcessingJob {
  id: string;
  jobType: string;
  status: ProcessingStatus;
  attempts: number;
  errorMessage: string | null;
  updatedAt: string;
}

export interface CameraCaptureRecord {
  id: string;
  devicePlatform: string | null;
  captureMode: string;
  imageCount: number;
  captureQualityScore: number | null;
  createdAt: string;
}

export interface ScanDetail {
  id: string;
  organizationId: string;
  userId: string;
  uploadType: string;
  originalFilename: string | null;
  mimeType: string | null;
  processingStatus: ProcessingStatus;
  ocrStatus: OcrStatus;
  privacyLevel: PrivacyLevel;
  pageCount: number | null;
  classifiedDocumentType: string | null;
  createdAt: string;
  cameraCaptures: CameraCaptureRecord[];
  processingJobs: ProcessingJob[];
}

export interface ScanDetailResponse {
  success: boolean;
  data: ScanDetail;
}

export interface OcrPage {
  id: string;
  pageNumber: number;
  qualityScore: number | null;
  ocrConfidence: number | null;
  languageDetected: string | null;
  wordCount: number | null;
  createdAt: string;
}

export interface ExtractedCitation {
  text: string;
  normalized: string;
  documentType: string;
}

export interface OcrResults {
  uploadId: string;
  ocrStatus: OcrStatus;
  classifiedDocumentType: string | null;
  extractedCitations: { citations: ExtractedCitation[] } | null;
  ocrText: string | null;
  pages: OcrPage[];
}

export interface OcrResultsResponse {
  success: boolean;
  data: OcrResults;
}

export interface GenerateDigestResponse {
  success: boolean;
  data: {
    digestId: string;
    status: string;
  };
}

export interface MatterDocumentRecord {
  id: string;
  matterId: string;
  userUploadId: string;
  title: string | null;
  role: string;
  createdAt: string;
}

export interface AttachToMatterResponse {
  success: boolean;
  data: MatterDocumentRecord;
}

export interface GeneratedFlashcard {
  id: string;
  flashcardSetId: string;
  front: string;
  back: string;
  sourceType: string;
  ordering: number;
  createdAt: string;
}

export interface GenerateFlashcardsResponse {
  success: boolean;
  data: {
    uploadId: string;
    flashcardSetId: string;
    generatedCount: number;
    flashcards: GeneratedFlashcard[];
    confidenceScore: number;
    modelName: string;
  };
}

export interface OutlineSection {
  heading: string;
  key_points: string[];
  subsections?: {
    heading: string;
    key_points: string[];
  }[];
}

export interface GenerateOutlineResponse {
  success: boolean;
  data: {
    uploadId: string;
    outlineType: string;
    outline: {
      title: string;
      sections: OutlineSection[];
    };
    confidenceScore: number;
    modelName: string;
  };
}
