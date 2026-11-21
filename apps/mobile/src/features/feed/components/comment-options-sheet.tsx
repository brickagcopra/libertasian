import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FeedCommentItem } from '@libertasian/types';
import { useBlockUser } from '../hooks/use-user-blocks';

interface CommentOptionsSheetProps {
  visible: boolean;
  comment: FeedCommentItem;
  onClose: () => void;
  onReport: () => void;
}

/**
 * Moderation actions on someone else's comment (Apple 1.2): report it, or
 * block its author. Mirrors the non-owner half of `PostOptionsSheet`.
 */
export function CommentOptionsSheet({ visible, comment, onClose, onReport }: CommentOptionsSheetProps) {
  const blockUser = useBlockUser();

  const handleBlock = () => {
    onClose();
    Alert.alert(
      `Block ${comment.author.fullName}?`,
      'You will no longer see their posts or comments, and they will no longer see yours or be able to reply to you. You can undo this in Settings > Blocked users.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          // Failure is surfaced by useBlockUser's own onError; its onSettled
          // refetches the comment list, which drops the blocked author.
          onPress: () => blockUser.mutate(comment.author.id),
        },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <TouchableOpacity
            style={styles.option}
            onPress={() => {
              onClose();
              onReport();
            }}
          >
            <Ionicons name="flag-outline" size={22} color="#dc2626" />
            <Text style={[styles.optionText, styles.destructive]}>Report Comment</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.option} onPress={handleBlock}>
            <Ionicons name="person-remove-outline" size={22} color="#dc2626" />
            <Text style={[styles.optionText, styles.destructive]}>
              Block {comment.author.fullName}
            </Text>
          </TouchableOpacity>

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
