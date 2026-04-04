import React from 'react';
import { render } from '@testing-library/react-native';

import { UploadProgress } from './upload-progress';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) =>
      require('react').createElement(Text, { testID: `icon-${name}` }, name),
  };
});

describe('UploadProgress', () => {
  it('renders title', () => {
    const { getByText } = render(
      <UploadProgress uploadProgress={0} currentStep="uploading" />,
    );

    expect(getByText('Processing Scan')).toBeTruthy();
  });

  it('shows progress bar during upload step', () => {
    const { getByText } = render(
      <UploadProgress uploadProgress={0.45} currentStep="uploading" />,
    );

    expect(getByText('45%')).toBeTruthy();
  });

  it('renders all pipeline step labels', () => {
    const { getByText } = render(
      <UploadProgress uploadProgress={0} currentStep="uploading" />,
    );

    expect(getByText('Uploading')).toBeTruthy();
    expect(getByText('Quality Check')).toBeTruthy();
    expect(getByText('OCR')).toBeTruthy();
    expect(getByText('Classification')).toBeTruthy();
    expect(getByText('Citations')).toBeTruthy();
    expect(getByText('Digest')).toBeTruthy();
  });

  it('renders step descriptions', () => {
    const { getByText } = render(
      <UploadProgress uploadProgress={0} currentStep="ocr" />,
    );

    expect(getByText('Extracting text from images')).toBeTruthy();
    expect(getByText('Sending images to server')).toBeTruthy();
  });

  it('shows success banner when complete', () => {
    const { getByText, getAllByTestId } = render(
      <UploadProgress uploadProgress={1} currentStep="complete" />,
    );

    expect(getByText('Processing complete')).toBeTruthy();
    // Multiple checkmark-circle icons: one per completed pipeline step + success banner
    expect(getAllByTestId('icon-checkmark-circle').length).toBeGreaterThanOrEqual(1);
  });

  it('shows error banner when error provided', () => {
    const { getByText, getByTestId } = render(
      <UploadProgress
        uploadProgress={0.5}
        currentStep="ocr"
        error="OCR processing failed"
      />,
    );

    expect(getByText('OCR processing failed')).toBeTruthy();
    expect(getByTestId('icon-alert-circle')).toBeTruthy();
  });

  it('does not show progress bar for non-upload steps', () => {
    const { queryByText } = render(
      <UploadProgress uploadProgress={0.5} currentStep="ocr" />,
    );

    // percentage text should not appear when not in uploading step
    expect(queryByText('50%')).toBeNull();
  });

  it('shows 0% progress during upload', () => {
    const { getByText } = render(
      <UploadProgress uploadProgress={0} currentStep="uploading" />,
    );

    expect(getByText('0%')).toBeTruthy();
  });

  it('shows 100% progress at end of upload', () => {
    const { getByText } = render(
      <UploadProgress uploadProgress={1} currentStep="uploading" />,
    );

    expect(getByText('100%')).toBeTruthy();
  });
});
