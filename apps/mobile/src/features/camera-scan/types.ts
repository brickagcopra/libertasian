export interface CapturedPage {
  uri: string;
  width: number;
  height: number;
  id: string;
}

export type UploadType = 'document' | 'camera_scan';
export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type OcrStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type PrivacyLevel = 'private' | 'editorial_candidate';
export type DevicePlatform = 'ios' | 'android';
export type CaptureMode = 'single_page' | 'multi_page';

export interface UploadResponse {
  success: boolean;
  data: {
    id: string;
    jobId: string;
    status: string;
  };
}

export interface UploadListItem {
  id: string;
  uploadType: UploadType;
  originalFilename: string | null;
  mimeType: string | null;
  processingStatus: ProcessingStatus;
  privacyLevel: PrivacyLevel;
  pageCount: number | null;
  createdAt: string;
}

export interface UploadListResponse {
  success: boolean;
  data: UploadListItem[];
  meta: {
    hasNext: boolean;
    nextCursor: string | null;
  };
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
  devicePlatform: DevicePlatform | null;
  captureMode: CaptureMode;
  imageCount: number;
  captureQualityScore: number | null;
  createdAt: string;
}

export interface UploadDetail {
  id: string;
  organizationId: string;
  userId: string;
  uploadType: UploadType;
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

export interface UploadDetailResponse {
  success: boolean;
  data: UploadDetail;
}

export interface UploadStatusResponse {
  success: boolean;
  data: {
    id: string;
    processingStatus: ProcessingStatus;
    ocrStatus: OcrStatus;
    processingJobs: ProcessingJob[];
  };
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

export interface OcrResultsResponse {
  success: boolean;
  data: {
    uploadId: string;
    ocrStatus: OcrStatus;
    classifiedDocumentType: string | null;
    extractedCitations: { citations: ExtractedCitation[] } | null;
    ocrText: string | null;
    pages: OcrPage[];
  };
}

export interface GenerateDigestResponse {
  success: boolean;
  data: {
    digestId: string;
    status: string;
  };
}

export interface AttachToMatterResponse {
  success: boolean;
  data: {
    id: string;
    matterId: string;
    userUploadId: string;
    title: string | null;
    role: string;
    createdAt: string;
  };
}

export interface GenerateFlashcardsResponse {
  success: boolean;
  data: {
    uploadId: string;
    flashcardSetId: string;
    generatedCount: number;
    flashcards: {
      id: string;
      front: string;
      back: string;
      sourceType: string;
      ordering: number;
    }[];
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

export type PipelineStep =
  | 'uploading'
  | 'quality_check'
  | 'ocr'
  | 'classification'
  | 'citation_extraction'
  | 'digest_generation'
  | 'complete'
  | 'failed';

export interface PipelineStepInfo {
  key: PipelineStep;
  label: string;
  description: string;
}

export const PIPELINE_STEPS: PipelineStepInfo[] = [
  { key: 'uploading', label: 'Uploading', description: 'Sending images to server' },
  { key: 'quality_check', label: 'Quality Check', description: 'Analyzing image quality' },
  { key: 'ocr', label: 'OCR', description: 'Extracting text from images' },
  { key: 'classification', label: 'Classification', description: 'Identifying document type' },
  { key: 'citation_extraction', label: 'Citations', description: 'Extracting legal citations' },
  { key: 'digest_generation', label: 'Digest', description: 'Generating case digest' },
  { key: 'complete', label: 'Complete', description: 'Processing finished' },
];
