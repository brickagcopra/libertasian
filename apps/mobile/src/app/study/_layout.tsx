import { Stack } from 'expo-router';
import { SurfaceGuard } from '@/features/entitlements/surface-guard';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function StudyLayout() {
  // Guards the whole /study subtree. Every flashcard set and reviewer pack
  // below is its own deep-linkable route, and community screens link
  // straight into them.
  //
  // The codal reader used to be registered here and was hidden along with
  // everything else. It is free to read, so it now lives at `app/codals/`
  // with no guard — see that layout.
  return (
    <SurfaceGuard surface="study">
      <Stack screenOptions={sharedStackScreenOptions}>
        <Stack.Screen name="flashcards/index" options={{ title: 'Flashcard Sets' }} />
        <Stack.Screen name="flashcards/[id]" options={{ title: 'Flashcards' }} />
        <Stack.Screen name="reviewer-packs/index" options={{ title: 'Reviewer Packs' }} />
        <Stack.Screen name="reviewer-packs/[id]" options={{ title: 'Reviewer Pack' }} />
        <Stack.Screen name="syllabus/index" options={{ title: 'Bar Exam Syllabus' }} />
        <Stack.Screen name="syllabus/[subject]" options={{ title: 'Syllabus' }} />
        <Stack.Screen name="syllabus/[subject]/topic/[topicId]" options={{ title: 'Topic' }} />
      </Stack>
    </SurfaceGuard>
  );
}
