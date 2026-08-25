import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { ScanResult } from './scan-result';
import type { UploadDetail, OcrResultsResponse } from '../types';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) =>
      require('react').createElement(Text, { testID: `icon-${name}` }, name),
  };
});

jest.mock('./privacy-toggle', () => ({
  PrivacyToggle: ({ uploadId }: { uploadId: string }) => {
    const { Text } = require('react-native');
    return require('react').createElement(Text, { testID: 'privacy-toggle' }, `Privacy: ${uploadId}`);
  },
}));

jest.mock('../../../lib/constants', () => ({
  SCAN_QUALITY: {
    REJECT_THRESHOLD: 0.2,
    WARN_THRESHOLD: 0.4,
  },
}));

const makeUpload = (overrides: Partial<UploadDetail> = {}): UploadDetail => ({
  id: 'upload-1',
  organizationId: 'org-1',
  userId: 'user-1',
  uploadType: 'camera_scan',
  originalFilename: 'scan.jpg',
  mimeType: 'image/jpeg',
  processingStatus: 'completed',
  ocrStatus: 'completed',
  privacyLevel: 'private',
  pageCount: 1,
  classifiedDocumentType: 'supreme_court',
  createdAt: '2026-03-22T10:00:00Z',
  cameraCaptures: [
    {
      id: 'cap-1',
      devicePlatform: 'ios',
      captureMode: 'single_page',
      imageCount: 1,
      captureQualityScore: 0.85,
      createdAt: '2026-03-22T10:00:00Z',
    },
  ],
  processingJobs: [],
  ...overrides,
});

const makeOcrData = (overrides: Partial<OcrResultsResponse['data']> = {}): OcrResultsResponse['data'] => ({
  uploadId: 'upload-1',
  ocrStatus: 'completed',
  classifiedDocumentType: 'supreme_court',
  extractedCitations: {
    citations: [
      { text: 'G.R. No. 12345', normalized: 'G.R. No. 12345', documentType: 'case' },
    ],
  },
  ocrText: 'This is the extracted OCR text from the legal document.',
  pages: [
    {
      id: 'page-1',
      pageNumber: 1,
      qualityScore: 0.85,
      ocrConfidence: 0.92,
      languageDetected: 'en',
      wordCount: 500,
      createdAt: '2026-03-22T10:00:00Z',
    },
  ],
  ...overrides,
});

describe('ScanResult', () => {
  const defaultProps = {
    upload: makeUpload(),
    ocrData: makeOcrData(),
    isLoadingOcr: false,
    onGenerateDigest: jest.fn(),
    isGeneratingDigest: false,
    canGenerateDigest: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders Scan Results title', () => {
    const { getByText } = render(<ScanResult {...defaultProps} />);
    expect(getByText('Scan Results')).toBeTruthy();
  });

  it('shows good quality badge for high score', () => {
    const { getByText } = render(<ScanResult {...defaultProps} />);
    expect(getByText('Good Quality (85%)')).toBeTruthy();
  });

  it('shows fair quality badge for medium score', () => {
    const upload = makeUpload({
      cameraCaptures: [
        {
          id: 'cap-1',
          devicePlatform: 'ios',
          captureMode: 'single_page',
          imageCount: 1,
          captureQualityScore: 0.35,
          createdAt: '2026-03-22T10:00:00Z',
        },
      ],
    });

    const { getByText } = render(
      <ScanResult {...defaultProps} upload={upload} />,
    );

    expect(getByText('Fair Quality (35%)')).toBeTruthy();
  });

  it('shows low quality badge and alert for very low score', () => {
    const upload = makeUpload({
      cameraCaptures: [
        {
          id: 'cap-1',
          devicePlatform: 'ios',
          captureMode: 'single_page',
          imageCount: 1,
          captureQualityScore: 0.15,
          createdAt: '2026-03-22T10:00:00Z',
        },
      ],
    });

    const { getByText } = render(
      <ScanResult {...defaultProps} upload={upload} />,
    );

    expect(getByText('Low Quality (15%)')).toBeTruthy();
    expect(getByText(/retaking the scan/)).toBeTruthy();
  });

  it('shows classified document type', () => {
    const { getByText } = render(<ScanResult {...defaultProps} />);
    expect(getByText('supreme_court')).toBeTruthy();
  });

  it('renders tab bar with OCR Text, Citations, Details', () => {
    const { getByText } = render(<ScanResult {...defaultProps} />);

    expect(getByText('OCR Text')).toBeTruthy();
    expect(getByText('Citations')).toBeTruthy();
    expect(getByText('Details')).toBeTruthy();
  });

  it('shows OCR text in default tab', () => {
    const { getByText } = render(<ScanResult {...defaultProps} />);
    expect(getByText('This is the extracted OCR text from the legal document.')).toBeTruthy();
  });

  it('shows loading state', () => {
    const { getByText } = render(
      <ScanResult {...defaultProps} isLoadingOcr={true} />,
    );
    expect(getByText('Loading OCR results...')).toBeTruthy();
  });

  it('shows Generate AI Digest button when canGenerateDigest', () => {
    const { getByText } = render(<ScanResult {...defaultProps} />);
    expect(getByText('Generate AI Digest')).toBeTruthy();
  });

  it('calls onGenerateDigest when button pressed', () => {
    const onGenerateDigest = jest.fn();
    const { getByText } = render(
      <ScanResult {...defaultProps} onGenerateDigest={onGenerateDigest} />,
    );

    fireEvent.press(getByText('Generate AI Digest'));
    expect(onGenerateDigest).toHaveBeenCalledTimes(1);
  });

  it('shows generating state', () => {
    const { getByText } = render(
      <ScanResult {...defaultProps} isGeneratingDigest={true} />,
    );
    expect(getByText('Generating Digest...')).toBeTruthy();
  });

  // Inverted deliberately. This used to render a "not included in your plan"
  // notice whenever the caller was below Edu. There is no plan to be below any
  // more, so the notice — and the tier wording with it — is gone.
  it('renders no tier notice when the digest action is unavailable', () => {
    const { queryByText } = render(
      <ScanResult {...defaultProps} canGenerateDigest={false} />,
    );
    expect(
      queryByText(/plan|premium|upgrade|subscription|tier|not included/i),
    ).toBeNull();
  });

  it('shows digest error', () => {
    const { getByText } = render(
      <ScanResult {...defaultProps} digestError="Failed to generate digest" />,
    );
    expect(getByText('Failed to generate digest')).toBeTruthy();
  });

  it('shows flashcard result banner', () => {
    const { getByText } = render(
      <ScanResult
        {...defaultProps}
        flashcardResult={{ generatedCount: 10 }}
      />,
    );
    expect(getByText('Generated 10 flashcards')).toBeTruthy();
  });

  it('shows secondary action buttons whenever their handlers are supplied', () => {
    const { getByText } = render(
      <ScanResult
        {...defaultProps}
        onGenerateFlashcards={jest.fn()}
        onGenerateOutline={jest.fn()}
        onAttachToMatter={jest.fn()}
      />,
    );

    expect(getByText('Flashcards')).toBeTruthy();
    expect(getByText('Outline')).toBeTruthy();
    expect(getByText('Link to Matter')).toBeTruthy();
  });

  it('switches to citations tab', () => {
    const { getByText } = render(<ScanResult {...defaultProps} />);

    fireEvent.press(getByText('Citations'));
    expect(getByText('G.R. No. 12345')).toBeTruthy();
  });

  it('shows empty citations state', () => {
    const ocrData = makeOcrData({
      extractedCitations: { citations: [] },
    });

    const { getByText } = render(
      <ScanResult {...defaultProps} ocrData={ocrData} />,
    );

    fireEvent.press(getByText('Citations'));
    expect(getByText('No citations extracted.')).toBeTruthy();
  });
});
