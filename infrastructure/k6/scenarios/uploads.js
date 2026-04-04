// ==========================================================================
// LIBERTASIAN — k6 Scenario: File Uploads
// Tests: POST /uploads (multipart), GET /uploads/:id/status (polling)
// SLO: upload p95 < 5s, OCR pipeline p95 < 30s
// ==========================================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL } from '../lib/config.js';
import { getMultipartAuthHeaders } from '../lib/auth.js';
import { getAuthHeaders } from '../lib/auth.js';
import { checkStatus } from '../lib/checks.js';
import { randomIntBetween } from '../lib/data-generators.js';

// Custom metric: full OCR pipeline duration (upload → processing complete)
const ocrPipelineDuration = new Trend('ocr_pipeline_duration', true);

// Generate a minimal valid PDF binary for upload testing
// This is a ~100-byte valid PDF that won't trigger ClamAV but exercises the upload path
function generateTestPdf() {
  const pdfContent = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\n' +
    'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n' +
    '0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n206\n%%EOF';

  // Convert string to binary array for k6
  const bytes = [];
  for (let i = 0; i < pdfContent.length; i++) {
    bytes.push(pdfContent.charCodeAt(i));
  }
  return bytes;
}

// Generate a minimal JPEG binary (smallest valid JPEG: SOI + EOI markers)
function generateTestJpeg() {
  // Minimal valid JPEG with SOI, APP0/JFIF header, and EOI
  return [
    0xFF, 0xD8, // SOI
    0xFF, 0xE0, // APP0
    0x00, 0x10, // Length
    0x4A, 0x46, 0x49, 0x46, 0x00, // JFIF\0
    0x01, 0x01, // Version
    0x00, // Units
    0x00, 0x01, 0x00, 0x01, // Density
    0x00, 0x00, // Thumbnail
    0xFF, 0xD9, // EOI
  ];
}

/**
 * Upload a PDF file and poll for processing status.
 * Measures full OCR pipeline duration.
 */
export function uploadPdf(accessToken) {
  const pdfBytes = generateTestPdf();
  const filename = `k6-test-${Date.now()}-${randomIntBetween(1000, 9999)}.pdf`;

  const formData = {
    file: http.file(pdfBytes, filename, 'application/pdf'),
    privacyLevel: 'private',
  };

  const uploadStart = Date.now();

  const res = http.post(
    `${BASE_URL}/uploads`,
    formData,
    {
      ...getMultipartAuthHeaders(accessToken),
      tags: { name: 'upload_file' },
      timeout: '30s',
    },
  );

  // 202 Accepted = upload queued, 429 = rate limited
  const uploadOk = check(res, {
    'upload status 202': (r) => r.status === 202,
    'upload has id': (r) => {
      try {
        const body = r.json();
        return !!(body.success && body.data && body.data.id);
      } catch {
        return false;
      }
    },
  });

  if (!uploadOk || res.status !== 202) {
    sleep(5);
    return;
  }

  const uploadId = res.json().data.id;

  // Poll for processing completion (max 60s, 2s intervals)
  pollUploadStatus(accessToken, uploadId, uploadStart);
}

/**
 * Upload a JPEG image (simulates camera scan).
 */
export function uploadImage(accessToken) {
  const jpegBytes = generateTestJpeg();
  const filename = `k6-scan-${Date.now()}.jpg`;

  const formData = {
    file: http.file(jpegBytes, filename, 'image/jpeg'),
    privacyLevel: 'private',
  };

  const uploadStart = Date.now();

  const res = http.post(
    `${BASE_URL}/uploads`,
    formData,
    {
      ...getMultipartAuthHeaders(accessToken),
      tags: { name: 'upload_file' },
      timeout: '30s',
    },
  );

  const uploadOk = check(res, {
    'image upload status 202': (r) => r.status === 202,
  });

  if (!uploadOk || res.status !== 202) {
    sleep(5);
    return;
  }

  const uploadId = res.json().data.id;
  pollUploadStatus(accessToken, uploadId, uploadStart);
}

/**
 * Poll upload processing status until complete or timeout.
 */
function pollUploadStatus(accessToken, uploadId, startTime) {
  const maxPollTime = 60000; // 60 seconds max
  const pollInterval = 2; // 2 seconds between polls

  let elapsed = Date.now() - startTime;

  while (elapsed < maxPollTime) {
    sleep(pollInterval);

    const statusRes = http.get(
      `${BASE_URL}/uploads/${uploadId}/status`,
      {
        ...getAuthHeaders(accessToken),
        tags: { name: 'upload_status_poll' },
      },
    );

    if (statusRes.status !== 200) break;

    try {
      const body = statusRes.json();
      const status = body.data && body.data.status;

      if (status === 'completed' || status === 'failed' || status === 'quarantined') {
        const totalDuration = Date.now() - startTime;
        ocrPipelineDuration.add(totalDuration);
        break;
      }
    } catch {
      break;
    }

    elapsed = Date.now() - startTime;
  }
}

/**
 * Default function — alternates between PDF and image uploads.
 * Expects data.accessToken from setup().
 */
export default function (data) {
  if (!data || !data.accessToken) {
    console.warn('No auth data — skipping upload iteration');
    sleep(5);
    return;
  }

  if (Math.random() < 0.6) {
    uploadPdf(data.accessToken);
  } else {
    uploadImage(data.accessToken);
  }

  // Longer sleep between uploads to respect rate limits (20/hour)
  sleep(randomIntBetween(5, 10));
}
