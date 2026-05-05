import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { Alert } from 'react-native';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn(), back: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

jest.mock('@/features/camera-scan/components/camera-capture', () => ({
  CameraCapture: ({ onCapture, onClose, pageCount }: { onCapture: (p: unknown) => void; onClose: () => void; pageCount: number }) => {
    const { View, Text, TouchableOpacity } = require('react-native');
    return (
      <View>
        <Text>CameraCapture</Text>
        <Text>Pages: {pageCount}</Text>
        <TouchableOpacity testID="mock-capture" onPress={() => onCapture({ uri: 'file://img.jpg', width: 800, height: 1200, id: 'p1' })}>
          <Text>Capture</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="mock-close" onPress={onClose}>
          <Text>Close</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));

jest.mock('@/features/camera-scan/components/image-preview', () => ({
  ImagePreview: ({ page }: { page: { uri: string } }) => {
    const { Text } = require('react-native');
    return <Text>Preview: {page.uri}</Text>;
  },
}));

jest.mock('@/features/camera-scan/components/page-queue', () => ({
  PageQueue: ({ pages, selectedIndex }: { pages: unknown[]; selectedIndex: number }) => {
    const { Text } = require('react-native');
    return <Text>Queue: {pages.length} selected: {selectedIndex}</Text>;
  },
}));

import CaptureScreen from '@/app/scan/capture';

describe('CaptureScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders camera mode initially', () => {
    const { getByText } = render(<CaptureScreen />);
    expect(getByText('CameraCapture')).toBeTruthy();
    expect(getByText('Pages: 0')).toBeTruthy();
  });

  it('switches to preview mode after capture', () => {
    const { getByTestId, getByText } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('mock-capture'));
    expect(getByText(/Preview:/)).toBeTruthy();
    expect(getByText(/Queue: 1/)).toBeTruthy();
  });

  it('shows action buttons in preview mode', () => {
    const { getByTestId, getByText } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('mock-capture'));
    expect(getByText('Add Page')).toBeTruthy();
    expect(getByText('Done (1)')).toBeTruthy();
  });

  it('navigates back directly when no pages captured', () => {
    const { getByTestId } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('mock-close'));
    const { router } = require('expo-router');
    expect(router.back).toHaveBeenCalled();
  });

  it('shows discard confirmation when pages exist', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByTestId, getByText } = render(<CaptureScreen />);

    // Capture a page first
    fireEvent.press(getByTestId('mock-capture'));
    // Switch back to camera mode
    fireEvent.press(getByText('Add Page'));
    // Now close
    fireEvent.press(getByTestId('mock-close'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Discard Scan?',
      expect.stringContaining('1 captured page'),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Keep Scanning' }),
        expect.objectContaining({ text: 'Discard' }),
      ]),
    );
  });

  it('navigates to upload screen on Done press', () => {
    const { getByTestId, getByText } = render(<CaptureScreen />);
    fireEvent.press(getByTestId('mock-capture'));
    fireEvent.press(getByText('Done (1)'));

    const { router } = require('expo-router');
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/scan/upload',
      params: expect.objectContaining({
        pageCount: '1',
      }),
    });
  });
});
