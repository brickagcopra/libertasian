import { useRef, useEffect } from 'react';
import {
  View,
  Text,
  Animated,
  TouchableWithoutFeedback,
  StyleSheet,
  Dimensions,
} from 'react-native';
import type { Flashcard } from '../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 48;
const CARD_HEIGHT = 280;

interface FlashcardPlayerProps {
  card: Flashcard;
  isFlipped: boolean;
  onFlip: () => void;
}

export function FlashcardPlayer({
  card,
  isFlipped,
  onFlip,
}: FlashcardPlayerProps) {
  const flipAnim = useRef(new Animated.Value(0)).current;

  // Reset animation when card changes
  useEffect(() => {
    flipAnim.setValue(0);
  }, [card.id, flipAnim]);

  // Animate flip
  useEffect(() => {
    Animated.spring(flipAnim, {
      toValue: isFlipped ? 1 : 0,
      friction: 8,
      tension: 10,
      useNativeDriver: true,
    }).start();
  }, [isFlipped, flipAnim]);

  const frontInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const backInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '360deg'],
  });

  const frontOpacity = flipAnim.interpolate({
    inputRange: [0, 0.5, 0.5, 1],
    outputRange: [1, 1, 0, 0],
  });

  const backOpacity = flipAnim.interpolate({
    inputRange: [0, 0.5, 0.5, 1],
    outputRange: [0, 0, 1, 1],
  });

  return (
    <TouchableWithoutFeedback onPress={onFlip}>
      <View style={styles.cardContainer}>
        {/* Front */}
        <Animated.View
          style={[
            styles.card,
            styles.frontCard,
            {
              transform: [{ rotateY: frontInterpolate }],
              opacity: frontOpacity,
            },
          ]}
        >
          <View style={styles.sideLabel}>
            <Text style={styles.sideLabelText}>QUESTION</Text>
          </View>
          <Text style={styles.cardText}>{card.front}</Text>
          <Text style={styles.tapHint}>Tap to flip</Text>
        </Animated.View>

        {/* Back */}
        <Animated.View
          style={[
            styles.card,
            styles.backCard,
            {
              transform: [{ rotateY: backInterpolate }],
              opacity: backOpacity,
            },
          ]}
        >
          <View style={styles.sideLabel}>
            <Text style={[styles.sideLabelText, { color: '#059669' }]}>
              ANSWER
            </Text>
          </View>
          <Text style={styles.cardText}>{card.back}</Text>
          {card.legalDocument ? (
            <Text style={styles.sourceRef} numberOfLines={1}>
              Source: {card.legalDocument.title}
            </Text>
          ) : null}
        </Animated.View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    alignSelf: 'center',
  },
  card: {
    position: 'absolute',
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 16,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
    backfaceVisibility: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  frontCard: {
    backgroundColor: '#fff',
  },
  backCard: {
    backgroundColor: '#f0fdf4',
  },
  sideLabel: {
    position: 'absolute',
    top: 16,
    left: 20,
  },
  sideLabelText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1a56db',
    letterSpacing: 1,
  },
  cardText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
    lineHeight: 24,
    textAlign: 'center',
  },
  tapHint: {
    position: 'absolute',
    bottom: 16,
    fontSize: 12,
    color: '#9ca3af',
  },
  sourceRef: {
    position: 'absolute',
    bottom: 16,
    left: 20,
    right: 20,
    fontSize: 11,
    color: '#6b7280',
    textAlign: 'center',
  },
});
