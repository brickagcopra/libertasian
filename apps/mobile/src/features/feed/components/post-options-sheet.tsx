import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FeedPostItem } from '@libertasian/types';
import { useDeletePost } from '../hooks/use-create-post';

interface PostOptionsSheetProps {
  visible: boolean;
  post: FeedPostItem;
  isOwner: boolean;
  onClose: () => void;
  onEdit: () => void;
  onReport: () => void;
}

export function PostOptionsSheet({
  visible,
  post,
  isOwner,
  onClose,
  onEdit,
  onReport,
}: PostOptionsSheetProps) {
  const deletePost = useDeletePost();

  const handleDelete = () => {
    onClose();
    Alert.alert(
      'Delete Post',
      'Are you sure you want to delete this post? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deletePost.mutate(post.id),
        },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {isOwner ? (
            <>
              <TouchableOpacity style={styles.option} onPress={() => { onClose(); onEdit(); }}>
                <Ionicons name="create-outline" size={22} color="#374151" />
                <Text style={styles.optionText}>Edit Post</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.option} onPress={handleDelete}>
                <Ionicons name="trash-outline" size={22} color="#dc2626" />
                <Text style={[styles.optionText, styles.destructive]}>Delete Post</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.option} onPress={() => { onClose(); onReport(); }}>
              <Ionicons name="flag-outline" size={22} color="#dc2626" />
              <Text style={[styles.optionText, styles.destructive]}>Report Post</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 34,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#d1d5db',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  optionText: {
    fontSize: 15,
    color: '#374151',
  },
  destructive: {
    color: '#dc2626',
  },
  cancelButton: {
    alignItems: 'center',
    paddingTop: 16,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6b7280',
  },
});
