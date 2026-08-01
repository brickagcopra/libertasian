import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
} from 'react-native';
import { isCreativeAllowed, openCreativeUrl } from '../lib/creative-url-guard';
import type { AdCreative } from '../types';

interface AdInlineBannerProps {
  creative: AdCreative;
  campaignId: string;
  onDismiss: () => void;
  onImpression: () => void;
  onClick: () => void;
}

export function AdInlineBanner({
  creative,
  campaignId,
  onDismiss,
  onImpression,
  onClick,
}: AdInlineBannerProps) {
  const hasImpressed = useRef(false);

  useEffect(() => {
    if (!hasImpressed.current) {
      hasImpressed.current = true;
      onImpression();
    }
  }, [onImpression]);

  const handleCtaPress = () => {
    onClick();
    // Refuses purchase/pricing/checkout destinations (Apple 3.1.1 /
    // Play Payments). Creatives are server-authored and can change after
    // the binary ships.
    openCreativeUrl(creative.ctaUrl);
  };

  // Inline banners are mounted directly by screen components rather than
  // through AdRenderer, so they carry their own copy of the suppression
  // check — the renderer's guard would not cover them.
  if (!isCreativeAllowed(creative)) return null;

  const bgColor = creative.bgColor || '#f0f9ff';
  const textColor = creative.textColor || '#111827';
  const accentColor = creative.accentColor || '#1a56db';
  const borderRadius = creative.borderRadius ?? 12;

  return (
    <View style={[styles.container, { backgroundColor: bgColor, borderRadius }]}>
      {/* Sponsored label */}
      <Text style={styles.sponsoredLabel}>Sponsored</Text>

      <View style={styles.row}>
        {/* Image */}
        {creative.imageUrl && (
          <Image
            source={{ uri: creative.imageUrl }}
            style={styles.image}
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
            <TouchableOpacity onPress={handleCtaPress}>
              <Text style={[styles.ctaLink, { color: accentColor }]}>
                {creative.ctaText} &rarr;
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  sponsoredLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  image: {
    width: 64,
    height: 64,
    borderRadius: 8,
  },
  content: {
    flex: 1,
  },
  headline: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
  },
  body: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
    opacity: 0.7,
  },
  ctaLink: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
});
