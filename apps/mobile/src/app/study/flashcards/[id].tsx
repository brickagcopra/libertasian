import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFlashcardSet } from '../../../features/study/hooks/use-flashcard-sets';
import { useFlashcards } from '../../../features/study/hooks/use-flashcards';
import { useUpsertStudyProgress } from '../../../features/study/hooks/use-study-progress';
import {
  useFlashcardReviewStats,
  useSubmitFlashcardReview,
} from '../../../features/study/hooks/use-flashcard-reviews';
import {
  useStartStudySession,
  useEndStudySession,
} from '../../../features/study/hooks/use-study-sessions';
import { useExportFlashcardSet } from '../../../features/study/hooks/use-study-export';
import { FlashcardPlayer } from '../../../features/study/components/flashcard-player';
import { ProgressBar } from '../../../features/study/components/progress-bar';
import type { ExportFormat, SubmitFlashcardReviewInput } from '../../../features/study/types';

const REVIEW_BUTTONS: {
  response: SubmitFlashcardReviewInput['response'];
  label: string;
  color: string;
  bgColor: string;
  icon: 'close-circle' | 'alert-circle' | 'checkmark-circle' | 'star';
}[] = [
  { response: 'again', label: 'Again', color: '#dc2626', bgColor: '#fef2f2', icon: 'close-circle' },
  { response: 'hard', label: 'Hard', color: '#ea580c', bgColor: '#fff7ed', icon: 'alert-circle' },
  { response: 'good', label: 'Good', color: '#16a34a', bgColor: '#f0fdf4', icon: 'checkmark-circle' },
  { response: 'easy', label: 'Easy', color: '#2563eb', bgColor: '#eff6ff', icon: 'star' },
];

export default function FlashcardPlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const setId = id ?? '';

  const { data: set, isLoading: setLoading } = useFlashcardSet(setId);
  const { data: cards, isLoading: cardsLoading } = useFlashcards(setId);
  const { data: reviewStatsData } = useFlashcardReviewStats(setId);
  const upsertProgress = useUpsertStudyProgress();
  const submitReview = useSubmitFlashcardReview();
  const startSession = useStartStudySession();
  const endSession = useEndStudySession();
  const exportSet = useExportFlashcardSet();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const sessionIdRef = useRef<string | null>(null);

  const flashcards = cards ?? [];
  const currentCard = flashcards[currentIndex];
  const total = flashcards.length;
  const reviewStats = reviewStatsData;

  // Track progress and start session on first load
  useEffect(() => {
    if (total > 0 && !hasStarted) {
      setHasStarted(true);
      upsertProgress.mutate({
        entityType: 'flashcard_set',
        entityId: setId,
        input: { status: 'in_progress', progressPct: 0 },
      });
      startSession.mutate(
        {
          entityType: 'flashcard_set',
          entityId: setId,
          barSubject: set?.barSubject ?? undefined,
        },
        {
          onSuccess: (data) => {
            sessionIdRef.current = data.id;
          },
        },
      );
    }
    // Only run on first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  const endCurrentSession = useCallback(
    (itemsStudied: number) => {
      if (sessionIdRef.current) {
        endSession.mutate({
          sessionId: sessionIdRef.current,
          input: { itemsStudied, itemsCorrect: reviewedCount },
        });
        sessionIdRef.current = null;
      }
    },
    [endSession, reviewedCount],
  );

  const handleFlip = useCallback(() => {
    setIsFlipped((prev) => !prev);
  }, []);

  const handleReviewResponse = useCallback(
    (response: SubmitFlashcardReviewInput['response']) => {
      if (!currentCard) return;
      submitReview.mutate(
        {
          flashcardId: currentCard.id,
          input: { response },
        },
        {
          onSuccess: () => {
            setReviewedCount((c) => c + 1);
            setIsFlipped(false);
            if (currentIndex < total - 1) {
              setCurrentIndex((prev) => prev + 1);
            } else {
              endCurrentSession(total);
              upsertProgress.mutate({
                entityType: 'flashcard_set',
                entityId: setId,
                input: { status: 'completed', progressPct: 100 },
              });
            }
          },
        },
      );
    },
    [currentCard, submitReview, currentIndex, total, endCurrentSession, setId, upsertProgress],
  );

  const handleNext = useCallback(() => {
    if (currentIndex < total - 1) {
      setIsFlipped(false);
      setCurrentIndex((prev) => prev + 1);

      const newPct = Math.round(((currentIndex + 2) / total) * 100);
      upsertProgress.mutate({
        entityType: 'flashcard_set',
        entityId: setId,
        input: {
          status: newPct >= 100 ? 'completed' : 'in_progress',
          progressPct: Math.min(newPct, 100),
        },
      });
    }
  }, [currentIndex, total, setId, upsertProgress]);

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setIsFlipped(false);
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  const handleExport = useCallback(() => {
    if (!set) return;
    Alert.alert('Export Flashcards', 'Choose format:', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'PDF',
        onPress: () => exportSet.mutate({ id: setId, format: 'pdf' as ExportFormat, title: set.title }),
      },
      {
        text: 'DOCX',
        onPress: () => exportSet.mutate({ id: setId, format: 'docx' as ExportFormat, title: set.title }),
      },
    ]);
  }, [set, setId, exportSet]);

  if (setLoading || cardsLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Loading...' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  if (!set) {
    return (
      <>
        <Stack.Screen options={{ title: 'Error' }} />
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color="#ef4444" />
          <Text style={styles.errorTitle}>Set not found</Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  if (total === 0) {
    return (
      <>
        <Stack.Screen
          options={{ title: set.title, headerBackTitle: 'Sets' }}
        />
        <View style={styles.emptyState}>
          <Ionicons name="layers-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyTitle}>No flashcards</Text>
          <Text style={styles.emptyText}>
            This set has no cards yet. Add cards from the web app.
          </Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: set.title,
          headerBackTitle: 'Sets',
          headerRight: () => (
            <TouchableOpacity
              onPress={handleExport}
              disabled={exportSet.isPending || total === 0}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {exportSet.isPending ? (
                <ActivityIndicator size="small" color="#1a56db" />
              ) : (
                <Ionicons name="download-outline" size={22} color="#1a56db" />
              )}
            </TouchableOpacity>
          ),
        }}
      />
      <View style={styles.container}>
        {/* Mode Toggle */}
        <View style={styles.modeToggle}>
          <TouchableOpacity
            style={[styles.modeButton, !reviewMode && styles.modeButtonActive]}
            onPress={() => setReviewMode(false)}
          >
            <Text style={[styles.modeButtonText, !reviewMode && styles.modeButtonTextActive]}>
              Study
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, reviewMode && styles.modeButtonActive]}
            onPress={() => setReviewMode(true)}
          >
            <Text style={[styles.modeButtonText, reviewMode && styles.modeButtonTextActive]}>
              Review
            </Text>
            {reviewStats && reviewStats.dueCount > 0 && (
              <View style={styles.dueBadge}>
                <Text style={styles.dueBadgeText}>{reviewStats.dueCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Progress */}
        <View style={styles.progressSection}>
          <ProgressBar current={currentIndex + 1} total={total} />
        </View>

        {/* Card */}
        <View style={styles.cardSection}>
          {currentCard ? (
            <FlashcardPlayer
              card={currentCard}
              isFlipped={isFlipped}
              onFlip={handleFlip}
            />
          ) : null}
        </View>

        {/* Review Mode Buttons (shown when flipped) */}
        {reviewMode && isFlipped ? (
          <View style={styles.reviewControls}>
            {REVIEW_BUTTONS.map((btn) => (
              <TouchableOpacity
                key={btn.response}
                style={[styles.reviewButton, { backgroundColor: btn.bgColor, borderColor: btn.color }]}
                onPress={() => handleReviewResponse(btn.response)}
                disabled={submitReview.isPending}
              >
                <Ionicons name={btn.icon} size={18} color={btn.color} />
                <Text style={[styles.reviewButtonText, { color: btn.color }]}>
                  {btn.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : reviewMode && !isFlipped ? (
          <View style={styles.reviewHint}>
            <Text style={styles.reviewHintText}>Tap card to flip, then rate your recall</Text>
          </View>
        ) : (
          /* Standard Navigation Controls */
          <View style={styles.controls}>
            <TouchableOpacity
              style={[styles.navButton, currentIndex === 0 && styles.navButtonDisabled]}
              onPress={handlePrev}
              disabled={currentIndex === 0}
            >
              <Ionicons
                name="chevron-back"
                size={24}
                color={currentIndex === 0 ? '#d1d5db' : '#374151'}
              />
              <Text
                style={[
                  styles.navButtonText,
                  currentIndex === 0 && styles.navButtonTextDisabled,
                ]}
              >
                Prev
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.flipButton} onPress={handleFlip}>
              <Ionicons name="sync-outline" size={20} color="#fff" />
              <Text style={styles.flipButtonText}>Flip</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.navButton,
                currentIndex >= total - 1 && styles.navButtonDisabled,
              ]}
              onPress={handleNext}
              disabled={currentIndex >= total - 1}
            >
              <Text
                style={[
                  styles.navButtonText,
                  currentIndex >= total - 1 && styles.navButtonTextDisabled,
                ]}
              >
                Next
              </Text>
              <Ionicons
                name="chevron-forward"
                size={24}
                color={currentIndex >= total - 1 ? '#d1d5db' : '#374151'}
              />
            </TouchableOpacity>
          </View>
        )}

        {/* Review Count / Completion Banner */}
        {reviewMode && reviewedCount > 0 && (
          <View style={styles.reviewCountBanner}>
            <Text style={styles.reviewCountText}>
              Reviewed {reviewedCount} of {total} cards
            </Text>
          </View>
        )}

        {!reviewMode && currentIndex === total - 1 && isFlipped ? (
          <View style={styles.completionBanner}>
            <Ionicons name="checkmark-circle" size={20} color="#059669" />
            <Text style={styles.completionText}>
              You&apos;ve reviewed all {total} cards!
            </Text>
          </View>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#f3f4f6',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  backButton: {
    marginTop: 16,
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  backButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  modeToggle: {
    flexDirection: 'row',
    marginHorizontal: 24,
    marginTop: 12,
    backgroundColor: '#e5e7eb',
    borderRadius: 8,
    padding: 2,
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 6,
  },
  modeButtonActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  modeButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
  },
  modeButtonTextActive: {
    color: '#111827',
  },
  dueBadge: {
    backgroundColor: '#dc2626',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: 'center',
  },
  dueBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  progressSection: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  cardSection: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 32,
    paddingTop: 16,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  navButtonDisabled: { opacity: 0.4 },
  navButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  navButtonTextDisabled: { color: '#d1d5db' },
  flipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1a56db',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  flipButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  reviewControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 16,
  },
  reviewButton: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 70,
  },
  reviewButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  reviewHint: {
    alignItems: 'center',
    paddingBottom: 32,
    paddingTop: 16,
  },
  reviewHintText: {
    fontSize: 13,
    color: '#9ca3af',
  },
  reviewCountBanner: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  reviewCountText: {
    fontSize: 12,
    color: '#6b7280',
  },
  completionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ecfdf5',
    paddingVertical: 12,
    marginHorizontal: 24,
    marginBottom: 16,
    borderRadius: 10,
  },
  completionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#059669',
  },
});
