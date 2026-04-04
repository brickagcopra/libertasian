/**
 * Factory for creating mock BullMQ Job objects for processor integration tests.
 * Allows invoking processors directly without running a BullMQ worker.
 */

import { Job } from 'bullmq';

interface MockJobOptions {
  name?: string;
  data: Record<string, unknown>;
  attemptsMade?: number;
  id?: string;
}

/**
 * Create a minimal mock BullMQ Job for processor testing.
 * Only stubs the properties accessed by our processors.
 */
export function createMockJob<T = Record<string, unknown>>(options: MockJobOptions): Job<T> {
  const mockJob = {
    id: options.id ?? `mock-job-${Date.now()}`,
    name: options.name ?? 'default',
    data: options.data as T,
    attemptsMade: options.attemptsMade ?? 0,
    opts: { attempts: 3, delay: 0 },
    timestamp: Date.now(),
    progress: 0,
    returnvalue: null,

    // Stubs for methods the processor might call
    updateProgress: jest.fn().mockResolvedValue(undefined),
    log: jest.fn().mockResolvedValue(undefined),
    moveToFailed: jest.fn().mockResolvedValue(undefined),
    isActive: jest.fn().mockResolvedValue(true),
    isCompleted: jest.fn().mockResolvedValue(false),
    isFailed: jest.fn().mockResolvedValue(false),
  } as unknown as Job<T>;

  return mockJob;
}

/**
 * Create a mock Job for the uploads processor (file processing).
 */
export function createUploadJob(uploadId: string, jobId: string) {
  return createMockJob({
    name: 'process-upload',
    data: { uploadId, jobId },
  });
}

/**
 * Create a mock Job for the uploads processor (digest generation).
 */
export function createUploadDigestJob(params: {
  uploadId: string;
  digestId: string;
  ocrTextObjectKey: string;
  organizationId: string;
  userId: string;
}) {
  return createMockJob({
    name: 'generate-upload-digest',
    data: params,
  });
}

/**
 * Create a mock Job for the digests processor.
 */
export function createDigestJob(digestId: string, documentId: string) {
  return createMockJob({
    name: 'generate-digest',
    data: { digestId, documentId },
  });
}
