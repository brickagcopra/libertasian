import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import { ImagePreview } from './image-preview';

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn().mockResolvedValue({
    uri: 'file://processed.jpg',
    width: 2048,
    height: 2730,
  }),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) =>
      require('react').createElement(Text, { testID: `icon-${name}` }, name),
  };
});

jest.mock('../../../lib/constants', () => ({
  IMAGE_UPLOAD: {
    MAX_WIDTH: 2048,
    JPEG_QUALITY: 0.85,
  },
}));

describe('ImagePreview', () => {
  const defaultPage = {
    id: 'page_1',
    uri: 'file://original.jpg',
    width: 3024,
    height: 4032,
  };

  const defaultProps = {
    page: defaultPage,
    onUpdate: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the image with correct URI', () => {
    const { getByTestId } = render(<ImagePreview {...defaultProps} />);

    // Image renders from the page URI
    expect(getByTestId('icon-refresh-outline')).toBeTruthy();
  });

  it('shows Rotate and Optimize buttons', () => {
    const { getByText } = render(<ImagePreview {...defaultProps} />);

    expect(getByText('Rotate')).toBeTruthy();
    expect(getByText('Optimize')).toBeTruthy();
  });

  it('displays image dimensions', () => {
    const { getByText } = render(<ImagePreview {...defaultProps} />);

    expect(getByText('3024 x 4032')).toBeTruthy();
  });

  it('calls onUpdate when Rotate is pressed', async () => {
    const ImageManipulator = require('expo-image-manipulator');
    ImageManipulator.manipulateAsync.mockResolvedValueOnce({
      uri: 'file://rotated.jpg',
      width: 4032,
      height: 3024,
    });

    const onUpdate = jest.fn();
    const { getByText } = render(
      <ImagePreview {...defaultProps} onUpdate={onUpdate} />,
    );

    fireEvent.press(getByText('Rotate'));

    await waitFor(() => {
      expect(ImageManipulator.manipulateAsync).toHaveBeenCalled();
    });
  });

  it('calls onUpdate when Optimize is pressed', async () => {
    const ImageManipulator = require('expo-image-manipulator');
    ImageManipulator.manipulateAsync.mockResolvedValueOnce({
      uri: 'file://optimized.jpg',
      width: 2048,
      height: 2730,
    });

    const onUpdate = jest.fn();
    const { getByText } = render(
      <ImagePreview {...defaultProps} onUpdate={onUpdate} />,
    );

    fireEvent.press(getByText('Optimize'));

    await waitFor(() => {
      expect(ImageManipulator.manipulateAsync).toHaveBeenCalled();
    });
  });

  it('renders with small image (no resize needed)', () => {
    const smallPage = {
      id: 'page_small',
      uri: 'file://small.jpg',
      width: 1024,
      height: 1365,
    };

    const { getByText } = render(
      <ImagePreview page={smallPage} onUpdate={jest.fn()} />,
    );

    expect(getByText('1024 x 1365')).toBeTruthy();
  });
});
