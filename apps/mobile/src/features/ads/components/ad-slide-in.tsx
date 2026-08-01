import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Animated,
  StyleSheet,
} from 'react-native';
import { openCreativeUrl } from '../lib/creative-url-guard';
import { Ionicons } from '@expo/vector-icons';
import type { AdCreative } from '../types';

interface AdSlideInProps {
  creative: AdCreative;
  campaignId: string;
  visible: boolean;
  onDismiss: () => void;
  onImpression: () => void;
  onClick: () => void;
}

export function AdSlideIn({
  creative,
  campaignId,
  visible,
  onDismiss,
  onImpression,
  onClick,
}: AdSlideInProps) {
  const translateY = useRef(new Animated.Value(200)).current;
  const hasImpressed = useRef(false);

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }).start();

      if (!hasImpressed.current) {
        hasImpressed.current = true;
        onImpression();
      }
    } else {
      Animated.timing(translateY, {
        toValue: 200,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY, onImpression]);

  const handleCtaPress = () => {
    onClick();
    // Refuses purchase/pricing/checkout destinations (Apple 3.1.1 /
    // Play Payments). Creatives are server-authored and can change after
    // the binary ships.
    openCreativeUrl(creative.ctaUrl);
    onDismiss();
  };

  if (!visible) return null;

  const bgColor = creative.bgColor || '#ffffff';
  const textColor = creative.textColor || '#111827';
  const accentColor = creative.accentColor || '#1a56db';
  const borderRadius = creative.borderRadius ?? 12;

  const isLeft = creative.position === 'bottom_left' || creative.position === 'top_left';

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: bgColor,
          borderRadius,
          transform: [{ translateY }],
        },
        isLeft ? styles.positionLeft : styles.positionRight,
      ]}
    >
      {/* Close */}
      <TouchableOpacity
        style={styles.closeButton}
        onPress={onDismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="close" size={18} color="#9ca3af" />
      </TouchableOpacity>

      {/* Image */}
      {creative.imageUrl && (
        <Image
          source={{ uri: creative.imageUrl }}
          style={[styles.image, { borderTopLeftRadius: borderRadius, borderTopRightRadius: borderRadius }]}
          resizeMode="cover"
          accessibilityLabel={creative.imageAlt || 'Ad image'}
        />
      )}

      {/* Content */}
      <View style={styles.content}>
        {creative.headline && (
          <Text style={[styles.headline, { color: textColor }]} numberOfLines={2}>
            {creative.headline}
          </Text>
        )}
        {creative.bodyText && (
          <Text style={[styles.body, { color: textColor }]} numberOfLines={2}>
            {creative.bodyText}
          </Text>
        )}

        {creative.ctaText && (
          <TouchableOpacity
            style={[styles.ctaButton, { backgroundColor: accentColor }]}
            onPress={handleCtaPress}
          >
            <Text style={styles.ctaText}>{creative.ctaText}</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 80,
    width: 280,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  positionRight: {
    right: 16,
  },
  positionLeft: {
    left: 16,
  },
  closeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: 120,
  },
  content: {
    padding: 14,
  },
  headline: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  body: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
    opacity: 0.8,
  },
  ctaButton: {
    marginTop: 10,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  ctaText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
});
