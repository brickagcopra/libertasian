import React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { CreatePostForm } from '../../../features/feed/components/create-post-form';
import type { FeedPostVisibility } from '@libertasian/types';

export default function CreatePostScreen() {
  const params = useLocalSearchParams<{
    editPostId?: string;
    initialText?: string;
    initialVisibility?: FeedPostVisibility;
  }>();

  const isEditing = !!params.editPostId;

  return (
    <>
      <Stack.Screen
        options={{
          title: isEditing ? 'Edit Post' : 'Create Post',
        }}
      />
      <CreatePostForm
        editPostId={params.editPostId}
        initialText={params.initialText}
        initialVisibility={params.initialVisibility}
      />
    </>
  );
}
