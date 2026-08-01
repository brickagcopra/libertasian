import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
} from 'react-native';
import { openCreativeUrl } from '../lib/creative-url-guard';
import { Ionicons } from '@expo/vector-icons';
import type { AdCreative } from '../types';

interface AdFloatingBarProps {
  creative: AdCreative;
  campaignId: string;
  visible: boolean;
  onDismiss: () => void;
  onImpression: () => void;
  onClick: () => void;
}

export function AdFloatingBar({
  creative,
  campaignId,
  visible,
  onDismiss,
  onImpression,
  onClick,
}: AdFloatingBarProps) {
  const translateY = useRef(new Animated.Value(100)).current;
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
        toValue: 100,
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

  const bgColor = creative.bgColor || '#1a56db';
  const textColor = creative.textColor || '#ffffff';
  const accentColor = creative.accentColor || '#ffffff';

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: bgColor,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.content}>
        {creative.headline && (
          <Text style={[styles.headline, { color: textColor }]} numberOfLines={1}>
            {creative.headline}
          </Text>
        )}

        {creative.ctaText && (
          <TouchableOpacity
            style={[styles.ctaButton, { borderColor: accentColor }]}
            onPress={handleCtaPress}
          >
            <Text style={[styles.ctaText, { color: accentColor }]}>
              {creative.ctaText}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={styles.closeButton}
        onPress={onDismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="close" size={18} color={textColor} style={{ opacity: 0.7 }} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 6,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headline: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  ctaButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1.5,
  },
  ctaText: {
    fontSize: 13,
    fontWeight: '600',
  },
  closeButton: {
    marginLeft: 8,
    padding: 4,
  },
});
