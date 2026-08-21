import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Catch-all for any path Expo Router cannot match.
 *
 * Without this file a dead link renders Expo's built-in "Unmatched Route"
 * screen — a developer diagnostic listing the attempted path, with no way
 * back into the app. That is what every `/digests/<id>` tap hit before this
 * PR (the mobile route is `digest/[id]`, singular).
 *
 * The fixed call sites are the actual fix; this is the floor under the next
 * one. It deliberately uses hardcoded colours and no hooks so it renders
 * regardless of which part of the tree the bad navigation came from.
 */
export default function NotFoundScreen() {
  // replace, not push: the unmatched path should not stay on the back stack.
  const goHome = (): void => router.replace('/(tabs)');

  return (
    <View style={styles.container} testID="not-found-screen">
      <Text style={styles.title}>Page not found</Text>
      <Text style={styles.message}>
        We couldn&apos;t find the page you were looking for.
      </Text>

      <Pressable style={styles.button} onPress={goHome} testID="not-found-go-home">
        <Text style={styles.buttonLabel}>Back to home</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
    backgroundColor: '#F6F1E8',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: '#1C1A14',
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    color: '#1C1A14',
    opacity: 0.7,
    textAlign: 'center',
    marginBottom: 12,
  },
  button: {
    minWidth: 200,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: '#1C1A14',
    alignItems: 'center',
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F6F1E8',
  },
});
