import { useState, useCallback } from 'react';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ExportSheet } from './export-sheet';
import type { ExportContentType } from '../types';

interface ExportButtonProps {
  contentType: ExportContentType;
  contentId: string;
  title: string;
  color?: string;
  size?: number;
}

export function ExportButton({
  contentType,
  contentId,
  title,
  color = '#374151',
  size = 22,
}: ExportButtonProps) {
  const [visible, setVisible] = useState(false);

  const handleOpen = useCallback(() => setVisible(true), []);
  const handleClose = useCallback(() => setVisible(false), []);

  return (
    <>
      <TouchableOpacity
        onPress={handleOpen}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="download-outline" size={size} color={color} />
      </TouchableOpacity>

      <ExportSheet
        visible={visible}
        onClose={handleClose}
        contentType={contentType}
        contentId={contentId}
        title={title}
      />
    </>
  );
}
