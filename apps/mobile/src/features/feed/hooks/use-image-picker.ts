import { useState, useCallback } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

export interface PickedImage {
  uri: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
}

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.85;

export function useImagePicker() {
  const [pickedImage, setPickedImage] = useState<PickedImage | null>(null);
  const [isPickerLoading, setIsPickerLoading] = useState(false);

  const pickImage = useCallback(async () => {
    setIsPickerLoading(true);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        return null;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 1,
      });

      if (result.canceled || !result.assets[0]) {
        return null;
      }

      const asset = result.assets[0];
      const compressed = await compressImage(asset.uri, asset.width, asset.height);
      const image: PickedImage = {
        uri: compressed.uri,
        fileName: asset.fileName ?? `feed-image-${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
        width: compressed.width,
        height: compressed.height,
      };
      setPickedImage(image);
      return image;
    } finally {
      setIsPickerLoading(false);
    }
  }, []);

  const takePhoto = useCallback(async () => {
    setIsPickerLoading(true);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        return null;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 1,
      });

      if (result.canceled || !result.assets[0]) {
        return null;
      }

      const asset = result.assets[0];
      const compressed = await compressImage(asset.uri, asset.width, asset.height);
      const image: PickedImage = {
        uri: compressed.uri,
        fileName: asset.fileName ?? `feed-photo-${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
        width: compressed.width,
        height: compressed.height,
      };
      setPickedImage(image);
      return image;
    } finally {
      setIsPickerLoading(false);
    }
  }, []);

  const clearImage = useCallback(() => {
    setPickedImage(null);
  }, []);

  return { pickedImage, isPickerLoading, pickImage, takePhoto, clearImage };
}

async function compressImage(
  uri: string,
  width: number,
  height: number,
): Promise<{ uri: string; width: number; height: number }> {
  const actions: ImageManipulator.Action[] = [];

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    actions.push({ resize: { width: Math.round(width * scale), height: Math.round(height * scale) } });
  }

  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  return { uri: result.uri, width: result.width, height: result.height };
}
