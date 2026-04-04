/**
 * Camera Scans Seed Data — 4 user uploads with camera captures,
 * processing jobs, and OCR results.
 *
 * Scans:
 *   1. Member scans a Supreme Court decision (multi-page, high quality, completed)
 *   2. Student scans a Criminal Law case excerpt (single page, good quality, completed)
 *   3. Member scans a contract document (single page, low quality, warning issued)
 *   4. Student scans a Rules of Court excerpt (multi-page, processing in progress)
 */

import { Prisma, PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import { SeededUsers } from './dev-users';
import { SeededDigests } from './digests-data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScanSeed {
  userKey: keyof Omit<SeededUsers, 'orgId'>;
  originalFilename: string;
  mimeType: string;
  uploadType: string;
  pageCount: number;
  ocrStatus: string;
  processingStatus: string;
  privacyLevel: string;
  classifiedDocumentType: string | null;
  extractedCitations: string[] | null;
  capture: {
    devicePlatform: string;
    captureMode: string;
    imageCount: number;
    enhancementProfile: string;
    captureQualityScore: number;
    extractedTextStatus: string;
  };
  jobs: Array<{
    jobType: string;
    status: string;
    attempts: number;
    errorMessage: string | null;
  }>;
  ocrPages: Array<{
    pageNumber: number;
    qualityScore: number;
    ocrConfidence: number;
    languageDetected: string;
    wordCount: number;
  }>;
  /** Key in SeededDigests to link, or null */
  digestKey: string | null;
}

export interface SeededScans {
  memberScDecision: { id: string };
  studentCrimLawExcerpt: { id: string };
  memberContractDoc: { id: string };
  studentRulesExcerpt: { id: string };
}

// ---------------------------------------------------------------------------
// Scan Data
// ---------------------------------------------------------------------------

const SCANS: ScanSeed[] = [
  // =========================================================================
  // 1. Member scans a SC decision — multi-page, completed pipeline
  // =========================================================================
  {
    userKey: 'member',
    originalFilename: 'sc_decision_labor_case.jpg',
    mimeType: 'image/jpeg',
    uploadType: 'camera_scan',
    pageCount: 3,
    ocrStatus: 'completed',
    processingStatus: 'completed',
    privacyLevel: 'private',
    classifiedDocumentType: 'supreme_court',
    extractedCitations: [
      'G.R. No. 158693',
      'Article 297, Labor Code',
      'Serrano v. NLRC, G.R. No. 117040',
    ],
    capture: {
      devicePlatform: 'android',
      captureMode: 'multi_page',
      imageCount: 3,
      enhancementProfile: 'document_standard',
      captureQualityScore: 0.87,
      extractedTextStatus: 'completed',
    },
    jobs: [
      { jobType: 'quality_score', status: 'completed', attempts: 1, errorMessage: null },
      { jobType: 'ocr', status: 'completed', attempts: 1, errorMessage: null },
      { jobType: 'classify', status: 'completed', attempts: 1, errorMessage: null },
      { jobType: 'digest_generate', status: 'completed', attempts: 1, errorMessage: null },
    ],
    ocrPages: [
      { pageNumber: 1, qualityScore: 0.89, ocrConfidence: 0.94, languageDetected: 'en', wordCount: 520 },
      { pageNumber: 2, qualityScore: 0.85, ocrConfidence: 0.91, languageDetected: 'en', wordCount: 610 },
      { pageNumber: 3, qualityScore: 0.88, ocrConfidence: 0.93, languageDetected: 'en', wordCount: 480 },
    ],
    digestKey: null,
  },

  // =========================================================================
  // 2. Student scans Criminal Law case excerpt — single page, completed
  // =========================================================================
  {
    userKey: 'student',
    originalFilename: 'people_v_santos_page5.jpg',
    mimeType: 'image/jpeg',
    uploadType: 'camera_scan',
    pageCount: 1,
    ocrStatus: 'completed',
    processingStatus: 'completed',
    privacyLevel: 'private',
    classifiedDocumentType: 'supreme_court',
    extractedCitations: [
      'G.R. No. 147678',
      'People v. Cagoco, G.R. No. 148853',
      'Article 11(1), Revised Penal Code',
    ],
    capture: {
      devicePlatform: 'ios',
      captureMode: 'single_page',
      imageCount: 1,
      enhancementProfile: 'document_standard',
      captureQualityScore: 0.92,
      extractedTextStatus: 'completed',
    },
    jobs: [
      { jobType: 'quality_score', status: 'completed', attempts: 1, errorMessage: null },
      { jobType: 'ocr', status: 'completed', attempts: 1, errorMessage: null },
      { jobType: 'classify', status: 'completed', attempts: 1, errorMessage: null },
    ],
    ocrPages: [
      { pageNumber: 1, qualityScore: 0.93, ocrConfidence: 0.96, languageDetected: 'en', wordCount: 680 },
    ],
    digestKey: 'studentScanDigest',
  },

  // =========================================================================
  // 3. Member scans a contract document — low quality, warning
  // =========================================================================
  {
    userKey: 'member',
    originalFilename: 'contract_lease_agreement.jpg',
    mimeType: 'image/jpeg',
    uploadType: 'camera_scan',
    pageCount: 1,
    ocrStatus: 'completed',
    processingStatus: 'completed',
    privacyLevel: 'private',
    classifiedDocumentType: null,
    extractedCitations: null,
    capture: {
      devicePlatform: 'android',
      captureMode: 'single_page',
      imageCount: 1,
      enhancementProfile: 'document_low_light',
      captureQualityScore: 0.35,
      extractedTextStatus: 'completed',
    },
    jobs: [
      { jobType: 'quality_score', status: 'completed', attempts: 1, errorMessage: null },
      { jobType: 'ocr', status: 'completed', attempts: 2, errorMessage: null },
      { jobType: 'classify', status: 'failed', attempts: 3, errorMessage: 'Confidence below threshold (0.28). Unable to classify document type.' },
    ],
    ocrPages: [
      { pageNumber: 1, qualityScore: 0.35, ocrConfidence: 0.52, languageDetected: 'en', wordCount: 210 },
    ],
    digestKey: null,
  },

  // =========================================================================
  // 4. Student scans Rules of Court excerpt — in progress
  // =========================================================================
  {
    userKey: 'student',
    originalFilename: 'rules_of_court_rule16.jpg',
    mimeType: 'image/jpeg',
    uploadType: 'camera_scan',
    pageCount: 2,
    ocrStatus: 'processing',
    processingStatus: 'processing',
    privacyLevel: 'private',
    classifiedDocumentType: null,
    extractedCitations: null,
    capture: {
      devicePlatform: 'ios',
      captureMode: 'multi_page',
      imageCount: 2,
      enhancementProfile: 'document_standard',
      captureQualityScore: 0.78,
      extractedTextStatus: 'pending',
    },
    jobs: [
      { jobType: 'quality_score', status: 'completed', attempts: 1, errorMessage: null },
      { jobType: 'ocr', status: 'running', attempts: 1, errorMessage: null },
    ],
    ocrPages: [
      { pageNumber: 1, qualityScore: 0.8, ocrConfidence: 0.88, languageDetected: 'en', wordCount: 390 },
    ],
    digestKey: null,
  },
];

// ---------------------------------------------------------------------------
// Seed Function
// ---------------------------------------------------------------------------

export async function seedScans(
  prisma: PrismaClient,
  users: SeededUsers,
  digests: SeededDigests,
): Promise<SeededScans> {
  console.log('\n--- Seeding camera scans ---');

  const result = {} as SeededScans;
  const scanKeys = [
    'memberScDecision',
    'studentCrimLawExcerpt',
    'memberContractDoc',
    'studentRulesExcerpt',
  ];

  let totalOcrResults = 0;
  let totalJobs = 0;

  for (let i = 0; i < SCANS.length; i++) {
    const seed = SCANS[i];
    const key = scanKeys[i];
    if (!seed || !key) continue;
    const userId = users[seed.userKey].id;
    const uploadUuid = crypto.randomUUID();
    const objectKey = `uploads/${users.orgId}/${userId}/${uploadUuid}/${seed.originalFilename}`;
    const checksum = crypto
      .createHash('sha256')
      .update(`seed-scan-${key}-${seed.originalFilename}`)
      .digest('hex');

    // Resolve digest link if applicable
    let digestId: string | null = null;
    if (seed.digestKey && digests[seed.digestKey as keyof SeededDigests]) {
      digestId = digests[seed.digestKey as keyof SeededDigests].id;
    }

    // Check if upload already exists (by checksum + userId)
    const existing = await prisma.userUpload.findFirst({
      where: { checksum, userId },
    });

    let upload;
    const uploadData = {
      organizationId: users.orgId,
      userId,
      uploadType: seed.uploadType,
      originalFilename: seed.originalFilename,
      mimeType: seed.mimeType,
      objectKey,
      checksum,
      pageCount: seed.pageCount,
      ocrStatus: seed.ocrStatus,
      processingStatus: seed.processingStatus,
      privacyLevel: seed.privacyLevel,
      classifiedDocumentType: seed.classifiedDocumentType,
      extractedCitationsJson: seed.extractedCitations ?? Prisma.JsonNull,
      ocrTextObjectKey: seed.ocrStatus === 'completed'
        ? `uploads/${users.orgId}/${userId}/${uploadUuid}/ocr_text.txt`
        : null,
      digestId,
    };

    if (existing) {
      // Clean related records before re-creating
      await prisma.ocrResult.deleteMany({ where: { userUploadId: existing.id } });
      await prisma.uploadProcessingJob.deleteMany({ where: { userUploadId: existing.id } });
      await prisma.cameraCapture.deleteMany({ where: { userUploadId: existing.id } });

      upload = await prisma.userUpload.update({
        where: { id: existing.id },
        data: uploadData,
      });
    } else {
      upload = await prisma.userUpload.create({ data: uploadData });
    }

    // Camera capture record
    await prisma.cameraCapture.create({
      data: {
        userUploadId: upload.id,
        devicePlatform: seed.capture.devicePlatform,
        captureMode: seed.capture.captureMode,
        imageCount: seed.capture.imageCount,
        enhancementProfile: seed.capture.enhancementProfile,
        captureQualityScore: seed.capture.captureQualityScore,
        extractedTextStatus: seed.capture.extractedTextStatus,
      },
    });

    // Processing jobs
    for (const job of seed.jobs) {
      await prisma.uploadProcessingJob.create({
        data: {
          userUploadId: upload.id,
          jobType: job.jobType,
          status: job.status,
          attempts: job.attempts,
          errorMessage: job.errorMessage,
        },
      });
      totalJobs++;
    }

    // OCR results
    const ocrObjectKeyBase = `uploads/${users.orgId}/${userId}/${uploadUuid}`;
    for (const page of seed.ocrPages) {
      await prisma.ocrResult.create({
        data: {
          userUploadId: upload.id,
          pageNumber: page.pageNumber,
          qualityScore: page.qualityScore,
          ocrConfidence: page.ocrConfidence,
          languageDetected: page.languageDetected,
          extractedTextObjectKey: `${ocrObjectKeyBase}/ocr_page_${page.pageNumber}.txt`,
          wordCount: page.wordCount,
        },
      });
      totalOcrResults++;
    }

    result[key as keyof SeededScans] = { id: upload.id };
    console.log(
      `  Scan: ${seed.originalFilename} (${seed.capture.captureMode}, quality=${seed.capture.captureQualityScore}, ${seed.processingStatus})`,
    );
  }

  console.log(
    `  ${SCANS.length} scans seeded, ${totalJobs} processing jobs, ${totalOcrResults} OCR results.`,
  );

  return result;
}
