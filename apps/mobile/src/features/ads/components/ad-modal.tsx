import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Modal,
  Animated,
  Linking,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AdCreative } from '../types';

interface AdModalProps {
  creative: AdCreative;
  campaignId: string;
  visible: boolean;
  onDismiss: () => void;
  onImpression: () => void;
  onClick: () => void;
}

export function AdModal({
  creative,
  campaignId,
  visible,
  onDismiss,
  onImpression,
  onClick,
}: AdModalProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;
  const hasImpressed = useRef(false);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();

      if (!hasImpressed.current) {
        hasImpressed.current = true;
        onImpression();
      }
    }
  }, [visible, opacity, scale, onImpression]);

  const handleCtaPress = () => {
    onClick();
    if (creative.ctaUrl) {
      if (creative.ctaUrl.startsWith('http')) {
        Linking.openURL(creative.ctaUrl);
      }
    }
    onDismiss();
  };

  const bgColor = creative.bgColor || '#ffffff';
  const textColor = creative.textColor || '#111827';
  const accentColor = creative.accentColor || '#1a56db';
  const borderRadius = creative.borderRadius ?? 16;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.container,
            {
              backgroundColor: bgColor,
              borderRadius,
              opacity,
              transform: [{ scale }],
            },
          ]}
        >
          {/* Close button */}
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onDismiss}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={22} color="#9ca3af" />
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
              <Text style={[styles.headline, { color: textColor }]}>
                {creative.headline}
              </Text>
            )}
            {creative.bodyText && (
              <Text style={[styles.body, { color: textColor }]}>
                {creative.bodyText}
              </Text>
            )}

            {/* CTA Buttons */}
            <View style={styles.actions}>
              {creative.ctaText && (
                <TouchableOpacity
                  style={[styles.ctaButton, { backgroundColor: accentColor }]}
                  onPress={handleCtaPress}
                >
                  <Text style={styles.ctaText}>{creative.ctaText}</Text>
                </TouchableOpacity>
              )}
              {creative.secondaryCtaText && (
                <TouchableOpacity style={styles.secondaryButton} onPress={onDismiss}>
                  <Text style={[styles.secondaryText, { color: textColor }]}>
                    {creative.secondaryCtaText}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  container: {
    width: '100%',
    maxWidth: 360,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10,
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: 180,
  },
  content: {
    padding: 20,
  },
  headline: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    opacity: 0.8,
  },
  actions: {
    marginTop: 16,
    gap: 10,
  },
  ctaButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  ctaText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  secondaryButton: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  secondaryText: {
    fontSize: 13,
    fontWeight: '500',
    opacity: 0.7,
  },
});
