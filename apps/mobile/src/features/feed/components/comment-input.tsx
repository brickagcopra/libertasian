import React, { useState, useCallback } from 'react';
import { View, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCreateComment } from '../hooks/use-feed-comments';

interface CommentInputProps {
  postId: string;
  parentId?: string;
  placeholder?: string;
  onSubmitted?: () => void;
}

export function CommentInput({ postId, parentId, placeholder, onSubmitted }: CommentInputProps) {
  const [text, setText] = useState('');
  const createComment = useCreateComment();

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;

    createComment.mutate(
      { postId, textContent: trimmed, parentId },
      {
        onSuccess: () => {
          setText('');
          onSubmitted?.();
        },
      },
    );
  }, [text, postId, parentId, createComment, onSubmitted]);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder={placeholder ?? 'Write a comment...'}
        placeholderTextColor="#9ca3af"
        value={text}
        onChangeText={setText}
        multiline
        maxLength={2000}
      />
      <TouchableOpacity
        style={[styles.sendButton, !text.trim() && styles.sendDisabled]}
        onPress={handleSubmit}
        disabled={!text.trim() || createComment.isPending}
      >
        {createComment.isPending ? (
          <ActivityIndicator size="small" color="#1a56db" />
        ) : (
          <Ionicons name="send" size={18} color={text.trim() ? '#1a56db' : '#9ca3af'} />
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    color: '#111827',
    maxHeight: 100,
    backgroundColor: '#f9fafb',
  },
  sendButton: {
    padding: 8,
  },
  sendDisabled: {
    opacity: 0.5,
  },
});
