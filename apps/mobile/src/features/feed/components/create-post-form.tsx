import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FeedPostVisibility } from '@libertasian/types';
import { useCreatePost, useUpdatePost } from '../hooks/use-create-post';
import { useUploadFeedMedia, useFeedMediaStatus, useDeleteFeedMedia } from '../hooks/use-feed-media';
import { useImagePicker } from '../hooks/use-image-picker';
import { ImagePickerButton } from './image-picker-button';
import { ImagePreview } from './image-preview';
import { Ionicons } from '@expo/vector-icons';
import { bottomInsetPadding } from '@/lib/safe-area';
import { useTheme } from '@/providers/theme-provider';

interface CreatePostFormProps {
  editPostId?: string;
  initialText?: string;
  initialVisibility?: FeedPostVisibility;
}

const MAX_TEXT_LENGTH = 5000;

const VISIBILITY_OPTIONS: { value: FeedPostVisibility; label: string; icon: string }[] = [
  { value: 'organization', label: 'Organization', icon: 'people-outline' },
  { value: 'public', label: 'Public', icon: 'earth-outline' },
  { value: 'draft', label: 'Draft', icon: 'document-outline' },
];

export function CreatePostForm({ editPostId, initialText = '', initialVisibility = 'organization' }: CreatePostFormProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  // This screen is presentation: 'modal' with headerShown: true
  // (feed/_layout.tsx), so the old hardcoded 88 was never the real header
  // height and the toolbar slid under the keyboard on the first keystroke.
  const headerHeight = useHeaderHeight();
  const [textContent, setTextContent] = useState(initialText);
  const [visibility, setVisibility] = useState<FeedPostVisibility>(initialVisibility);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const createPost = useCreatePost();
  const updatePost = useUpdatePost();
  const uploadMedia = useUploadFeedMedia();
  const deleteMedia = useDeleteFeedMedia();
  const mediaStatus = useFeedMediaStatus(mediaId);
  const { pickedImage, isPickerLoading, pickImage, takePhoto, clearImage } = useImagePicker();

  const isEditing = !!editPostId;
  // Bare { success, data } envelope — already unwrapped by `apiClient`.
  const processingStatus = mediaStatus.data?.processingStatus ?? null;
  const isMediaReady = !mediaId || processingStatus === 'ready';
  const isMediaFailed = processingStatus === 'failed' || processingStatus === 'quarantined';
  const canSubmit = textContent.trim().length > 0 && isMediaReady && !isMediaFailed;
  const isPending = createPost.isPending || updatePost.isPending;

  const handlePickImage = useCallback(async () => {
    const image = await pickImage();
    if (image) {
      setUploadProgress(0);
      uploadMedia.mutate(
        {
          uri: image.uri,
          fileName: image.fileName,
          mimeType: image.mimeType,
          onProgress: setUploadProgress,
        },
        {
          onSuccess: (res) => {
            setMediaId(res.mediaId);
          },
          onError: () => {
            Alert.alert('Upload Failed', 'Failed to upload image. Please try again.');
            clearImage();
          },
        },
      );
    }
  }, [pickImage, uploadMedia, clearImage]);

  const handleTakePhoto = useCallback(async () => {
    const image = await takePhoto();
    if (image) {
      setUploadProgress(0);
      uploadMedia.mutate(
        {
          uri: image.uri,
          fileName: image.fileName,
          mimeType: image.mimeType,
          onProgress: setUploadProgress,
        },
        {
          onSuccess: (res) => {
            setMediaId(res.mediaId);
          },
          onError: () => {
            Alert.alert('Upload Failed', 'Failed to upload image. Please try again.');
            clearImage();
          },
        },
      );
    }
  }, [takePhoto, uploadMedia, clearImage]);

  const handleRemoveImage = useCallback(() => {
    if (mediaId) {
      deleteMedia.mutate(mediaId);
      setMediaId(null);
    }
    clearImage();
    setUploadProgress(0);
  }, [mediaId, deleteMedia, clearImage]);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;

    if (isEditing && editPostId) {
      updatePost.mutate(
        { postId: editPostId, textContent: textContent.trim(), visibility },
        {
          onSuccess: () => {
            router.back();
          },
          onError: () => {
            Alert.alert('Error', 'Failed to update post. Please try again.');
          },
        },
      );
    } else {
      createPost.mutate(
        { textContent: textContent.trim(), visibility, mediaId: mediaId ?? undefined },
        {
          onSuccess: () => {
            router.back();
          },
          onError: () => {
            Alert.alert('Error', 'Failed to create post. Please try again.');
          },
        },
      );
    }
  }, [canSubmit, isEditing, editPostId, textContent, visibility, mediaId, createPost, updatePost]);

  // Cleanup unattached media on unmount
  useEffect(() => {
    return () => {
      if (mediaId && !isPending) {
        // Media may not have been attached to a post
      }
    };
  }, [mediaId, isPending]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Visibility picker */}
        <View testID="visibility-row" style={styles.visibilityRow}>
          {VISIBILITY_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.visibilityChip,
                { borderColor: theme.line, backgroundColor: theme.chipBg },
                visibility === opt.value && {
                  borderColor: theme.accent,
                  backgroundColor: theme.accentSoft,
                },
              ]}
              onPress={() => setVisibility(opt.value)}
            >
              <Ionicons
                name={opt.icon as keyof typeof Ionicons.glyphMap}
                size={14}
                color={visibility === opt.value ? theme.accent : theme.inkSoft}
              />
              <Text
                // One line, and allowed to shrink inside the chip: at the
                // largest non-accessibility Dynamic Type step the three labels
                // no longer fit one row, and Yoga's flexShrink defaults to 0 —
                // so without this the row overflowed and "Draft" was pushed
                // off-screen rather than wrapping.
                numberOfLines={1}
                style={[
                  styles.visibilityText,
                  { color: visibility === opt.value ? theme.accent : theme.inkSoft },
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Text input */}
        <TextInput
          style={[styles.textInput, { color: theme.ink }]}
          placeholder="What's on your mind?"
          placeholderTextColor={theme.inkFaint}
          value={textContent}
          onChangeText={setTextContent}
          multiline
          maxLength={MAX_TEXT_LENGTH}
          textAlignVertical="top"
          autoFocus
        />

        {/* Character counter */}
        <Text
          style={[
            styles.charCount,
            { color: theme.inkFaint },
            textContent.length > MAX_TEXT_LENGTH * 0.9 && styles.charCountWarn,
          ]}
        >
          {textContent.length}/{MAX_TEXT_LENGTH}
        </Text>

        {/* Image preview */}
        {pickedImage && (
          <ImagePreview
            uri={pickedImage.uri}
            width={pickedImage.width}
            height={pickedImage.height}
            uploadProgress={uploadProgress}
            processingStatus={processingStatus}
            onRemove={handleRemoveImage}
            editable
          />
        )}

        {isMediaFailed && (
          <Text style={styles.errorText}>
            Image processing failed. Please remove it and try a different image.
          </Text>
        )}
      </ScrollView>

      {/* Bottom toolbar */}
      <View
        testID="create-post-toolbar"
        style={[
          styles.toolbar,
          {
            borderTopColor: theme.line,
            backgroundColor: theme.surface,
            // Clears the home indicator when the keyboard is DOWN. With the
            // keyboard up, KeyboardAvoidingView lifts the whole container and
            // this padding simply rides along.
            paddingBottom: bottomInsetPadding(insets, 10),
          },
        ]}
      >
        {!isEditing && (
          <ImagePickerButton
            onPickFromLibrary={handlePickImage}
            onTakePhoto={handleTakePhoto}
            disabled={!!pickedImage || isPickerLoading}
          />
        )}
        <View style={styles.toolbarSpacer} />
        <TouchableOpacity
          style={[
            styles.submitButton,
            { backgroundColor: theme.accent },
            (!canSubmit || isPending) && styles.submitDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit || isPending}
        >
          {isPending ? (
            <ActivityIndicator size="small" color={theme.accentInk} />
          ) : (
            <Text style={[styles.submitText, { color: theme.accentInk }]}>
              {isEditing ? 'Update' : 'Post'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  visibilityRow: {
    flexDirection: 'row',
    // Wraps rather than overflowing: at large Dynamic Type the three chips
    // exceed one row on every iPhone width, and an unwrapped row would push
    // the last chip past the screen edge instead of moving it to a new line.
    flexWrap: 'wrap',
    rowGap: 8,
    columnGap: 8,
    marginBottom: 14,
  },
  visibilityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    // Lets a chip give up width before the row overflows.
    flexShrink: 1,
  },
  visibilityText: {
    fontSize: 12,
    fontWeight: '500',
    flexShrink: 1,
  },
  textInput: {
    fontSize: 15,
    lineHeight: 22,
    minHeight: 120,
  },
  charCount: {
    fontSize: 11,
    textAlign: 'right',
    marginTop: 4,
  },
  charCountWarn: {
    color: '#d97706',
  },
  errorText: {
    fontSize: 12,
    color: '#dc2626',
    marginTop: 8,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolbarSpacer: {
    flex: 1,
  },
  submitButton: {
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  submitDisabled: {
    opacity: 0.5,
  },
  submitText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});
