import { useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  FlatList,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CapturedPage } from '../types';

interface PageQueueProps {
  pages: CapturedPage[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onDelete: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function PageQueue({
  pages,
  selectedIndex,
  onSelect,
  onDelete,
  onReorder,
}: PageQueueProps) {
  const canMoveUp = selectedIndex > 0;
  const canMoveDown = selectedIndex < pages.length - 1;

  const handleMoveUp = useCallback(() => {
    if (canMoveUp) {
      onReorder(selectedIndex, selectedIndex - 1);
    }
  }, [canMoveUp, selectedIndex, onReorder]);

  const handleMoveDown = useCallback(() => {
    if (canMoveDown) {
      onReorder(selectedIndex, selectedIndex + 1);
    }
  }, [canMoveDown, selectedIndex, onReorder]);

  const renderItem = useCallback(
    ({ item, index }: { item: CapturedPage; index: number }) => {
      const isSelected = index === selectedIndex;
      return (
        <TouchableOpacity
          style={[styles.thumbnail, isSelected && styles.thumbnailSelected]}
          onPress={() => onSelect(index)}
          activeOpacity={0.7}
        >
          <Image source={{ uri: item.uri }} style={styles.thumbnailImage} />
          <View style={styles.pageNumber}>
            <Text style={styles.pageNumberText}>{index + 1}</Text>
          </View>
          {isSelected && (
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => onDelete(index)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={20} color="#ef4444" />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      );
    },
    [selectedIndex, onSelect, onDelete],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{pages.length} page{pages.length !== 1 ? 's' : ''}</Text>
        <View style={styles.reorderButtons}>
          <TouchableOpacity
            onPress={handleMoveUp}
            disabled={!canMoveUp}
            style={[styles.reorderButton, !canMoveUp && styles.reorderButtonDisabled]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={18} color={canMoveUp ? '#1a56db' : '#d1d5db'} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleMoveDown}
            disabled={!canMoveDown}
            style={[styles.reorderButton, !canMoveDown && styles.reorderButtonDisabled]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-forward" size={18} color={canMoveDown ? '#1a56db' : '#d1d5db'} />
          </TouchableOpacity>
        </View>
      </View>
      <FlatList
        data={pages}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
    paddingBottom: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  reorderButtons: {
    flexDirection: 'row',
    gap: 4,
  },
  reorderButton: {
    padding: 4,
    borderRadius: 4,
    backgroundColor: '#f3f4f6',
  },
  reorderButtonDisabled: {
    opacity: 0.4,
  },
  list: {
    paddingHorizontal: 12,
    gap: 8,
  },
  thumbnail: {
    width: 64,
    height: 88,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
  },
  thumbnailSelected: {
    borderColor: '#1a56db',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  pageNumber: {
    position: 'absolute',
    bottom: 2,
    left: 2,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  pageNumberText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  deleteButton: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#fff',
    borderRadius: 10,
  },
});
