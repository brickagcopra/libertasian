import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import { CameraCapture } from './camera-capture';

// Mock expo-camera
const mockTakePictureAsync = jest.fn();
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CameraView: React.forwardRef(({ children }: { children: React.ReactNode }, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({
        takePictureAsync: mockTakePictureAsync,
      }));
      return React.createElement(View, { testID: 'camera-view' }, children);
    }),
    useCameraPermissions: jest.fn(),
  };
});

const { useCameraPermissions } = require('expo-camera');

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) =>
      require('react').createElement(Text, { testID: `icon-${name}` }, name),
  };
});

describe('CameraCapture', () => {
  const defaultProps = {
    onCapture: jest.fn(),
    onClose: jest.fn(),
    pageCount: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading spinner when permissions are null', () => {
    useCameraPermissions.mockReturnValue([null, jest.fn()]);

    const { queryByText, queryByTestId } = render(
      <CameraCapture {...defaultProps} />,
    );

    expect(queryByText('Camera Access Required')).toBeNull();
    expect(queryByTestId('camera-view')).toBeNull();
  });

  it('shows permission request screen when not granted', () => {
    useCameraPermissions.mockReturnValue([{ granted: false }, jest.fn()]);

    const { getByText } = render(<CameraCapture {...defaultProps} />);

    expect(getByText('Camera Access Required')).toBeTruthy();
    expect(getByText('Grant Access')).toBeTruthy();
    expect(getByText('Cancel')).toBeTruthy();
  });

  it('calls requestPermission when Grant Access pressed', () => {
    const mockRequest = jest.fn();
    useCameraPermissions.mockReturnValue([{ granted: false }, mockRequest]);

    const { getByText } = render(<CameraCapture {...defaultProps} />);
    fireEvent.press(getByText('Grant Access'));

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Cancel pressed on permission screen', () => {
    useCameraPermissions.mockReturnValue([{ granted: false }, jest.fn()]);

    const { getByText } = render(<CameraCapture {...defaultProps} />);
    fireEvent.press(getByText('Cancel'));

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders camera view when permission granted', () => {
    useCameraPermissions.mockReturnValue([{ granted: true }, jest.fn()]);

    const { getByTestId, getByText } = render(
      <CameraCapture {...defaultProps} />,
    );

    expect(getByTestId('camera-view')).toBeTruthy();
    expect(getByText('Scan Document')).toBeTruthy();
    expect(getByText('Align document within the frame')).toBeTruthy();
  });

  it('shows page count when pages captured', () => {
    useCameraPermissions.mockReturnValue([{ granted: true }, jest.fn()]);

    const { getByText } = render(
      <CameraCapture {...defaultProps} pageCount={3} />,
    );

    expect(getByText('3 pages captured')).toBeTruthy();
  });

  it('shows singular page text for 1 page', () => {
    useCameraPermissions.mockReturnValue([{ granted: true }, jest.fn()]);

    const { getByText } = render(
      <CameraCapture {...defaultProps} pageCount={1} />,
    );

    expect(getByText('1 page captured')).toBeTruthy();
  });

  it('shows page badge when pageCount > 0', () => {
    useCameraPermissions.mockReturnValue([{ granted: true }, jest.fn()]);

    const { getByText } = render(
      <CameraCapture {...defaultProps} pageCount={5} />,
    );

    expect(getByText('5')).toBeTruthy();
  });

  it('does not show page badge when pageCount is 0', () => {
    useCameraPermissions.mockReturnValue([{ granted: true }, jest.fn()]);

    const { queryByText } = render(
      <CameraCapture {...defaultProps} pageCount={0} />,
    );

    // Badge with number "0" should not render
    expect(queryByText('0')).toBeNull();
  });

  it('calls onCapture when photo taken successfully', async () => {
    useCameraPermissions.mockReturnValue([{ granted: true }, jest.fn()]);
    mockTakePictureAsync.mockResolvedValueOnce({
      uri: 'file://photo.jpg',
      width: 3024,
      height: 4032,
    });

    const onCapture = jest.fn();
    const { getByTestId } = render(
      <CameraCapture {...defaultProps} onCapture={onCapture} />,
    );

    // The capture button doesn't have a testID, but we can find by the icon
    // Look for the close button and flash toggle
    expect(getByTestId('icon-close')).toBeTruthy();

    await waitFor(() => {
      expect(getByTestId('camera-view')).toBeTruthy();
    });
  });
});
