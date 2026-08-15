import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FeedPostItem } from '@libertasian/types';
import { useDeletePost } from '../hooks/use-create-post';
import { useBlockUser } from '../hooks/use-user-blocks';

interface PostOptionsSheetProps {
  visible: boolean;
  post: FeedPostItem;
  isOwner: boolean;
  onClose: () => void;
  onEdit: () => void;
  onReport: () => void;
  /** Called after a block succeeds. Screens showing only this post use it to navigate away. */
  onBlocked?: () => void;
}

export function PostOptionsSheet({
  visible,
  post,
  isOwner,
  onClose,
  onEdit,
  onReport,
  onBlocked,
}: PostOptionsSheetProps) {
  const deletePost = useDeletePost();
  const blockUser = useBlockUser();

  const handleBlock = () => {
    onClose();
    Alert.alert(
      `Block ${post.author.fullName}?`,
      'You will no longer see their posts or comments, and they will no longer see yours or be able to reply to you. You can undo this in Settings > Blocked users.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          // Failure is surfaced by useBlockUser's own onError — a callback
          // passed here would be dropped when this sheet unmounts. onBlocked
          // is called optimistically for the same reason.
          onPress: () => {
            blockUser.mutate(post.author.id);
            onBlocked?.();
          },
        },
      ],
    );
  };

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
            <>
              <TouchableOpacity style={styles.option} onPress={() => { onClose(); onReport(); }}>
                <Ionicons name="flag-outline" size={22} color="#dc2626" />
                <Text style={[styles.optionText, styles.destructive]}>Report Post</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.option} onPress={handleBlock}>
                <Ionicons name="person-remove-outline" size={22} color="#dc2626" />
                <Text style={[styles.optionText, styles.destructive]}>
                  Block {post.author.fullName}
                </Text>
              </TouchableOpacity>
            </>
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
