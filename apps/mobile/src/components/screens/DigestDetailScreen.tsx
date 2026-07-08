import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode, Ref } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Photo } from '@/components/ui/Photo';
import { StickyCTA } from '@/components/ui/StickyCTA';
import { type PhotoTone } from '@/lib/design-tokens';
import { useTheme } from '@/providers/theme-provider';

export interface DigestSection {
  id: string;
  heading: string;
  paragraphs: string[];
}

export interface DigestAuthor {
  name: string;
  meta?: string;
}

/** Tone-aware badge rendered below the author row (trust/status/visibility/source/confidence). */
export interface DigestBadge {
  label: string;
  /** Visual treatment.
   *  - `accent` — accent color (TL;DR style)
   *  - `info` — neutral surface
   *  - `warn` — amber tone for AI-generated / needs-review
   *  - `success` — green for verified/approved
   *  - `private` — muted neutral for private visibility
   */
  tone?: 'accent' | 'info' | 'warn' | 'success' | 'private';
}

export interface DigestTopAction {
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  onPress?: () => void;
}

export interface DigestDetailScreenProps {
  /** Hero photo tone. Defaults 'warm'. */
  heroTone?: PhotoTone;
  /** Optional eyebrow badge above the headline (e.g. "Op-ed · Civil Liberties"). */
  eyebrow?: string;
  /** Headline displayed below the hero. */
  headline: string;
  /** Author + byline. */
  author?: DigestAuthor;
  /** First paragraph rendered with a serif drop cap. */
  intro?: string;
  /** TL;DR card body. Optional but recommended for digests. */
  tldr?: string;
  /** Structured digest sections (Facts, Issues, Ruling, Doctrine, etc). */
  sections?: DigestSection[];
  /**
   * Trust/status/visibility/source/confidence chips rendered below the author.
   * When provided alongside disclaimerSlot, both render (badges first).
   */
  badges?: DigestBadge[];
  /** Provenance/trust banner (e.g. ContentDisclaimer) rendered above the TL;DR. */
  disclaimerSlot?: ReactNode;
  /** Audio player bar (e.g. AudioPlayerBar) rendered between the disclaimer and the TL;DR. */
  playerSlot?: ReactNode;
  /** Additional top-right action buttons rendered alongside bookmark/share/more. */
  extraTopActions?: DigestTopAction[];
  /**
   * Replaces the default `sections` rendering when provided. When set,
   * `sections` is ignored.
   */
  customSections?: ReactNode;
  /** Ref to the content ScrollView (e.g. for read-along auto-follow). */
  scrollRef?: Ref<ScrollView>;
  /** Fires when the user starts dragging the content (not on programmatic scrolls). */
  onScrollBeginDrag?: () => void;
  /** Slot rendered after the body (e.g. timestamps). */
  footerSlot?: ReactNode;
  /** Reading progress 0..1. */
  progress?: number;
  /** Time-left text on the sticky bottom bar. */
  timeLeft?: string;
  onBack?: () => void;
  onMore?: () => void;
  onBookmark?: () => void;
  onShare?: () => void;
  /** Sticky CTA tap (e.g. start audio playback or open source doc). */
  onCTAPress?: () => void;
}

const TOP_ACTION_BG = 'rgba(255,255,255,0.92)';

/**
 * Default digest body: heading + paragraphs per section. Exported so the
 * read-along body can render the EXACT same markup as its plain fallback
 * (before audio starts / when no manifest exists).
 */
export function DigestPlainSections({ sections }: { sections: DigestSection[] }) {
  const { theme } = useTheme();
  return (
    <>
      {sections.map((section) => (
        <View key={section.id} style={{ marginTop: 22 }}>
          <Text
            style={{
              marginBottom: 8,
              fontFamily: theme.serif,
              fontSize: 22,
              letterSpacing: -0.4,
              color: theme.ink,
            }}
          >
            {section.heading}
          </Text>
          {section.paragraphs.map((para, i) => (
            <Text
              key={i}
              style={{
                fontFamily: theme.serif,
                fontSize: 17,
                lineHeight: 26.35,
                color: theme.ink,
                marginTop: i === 0 ? 0 : 14,
              }}
            >
              {para}
            </Text>
          ))}
        </View>
      ))}
    </>
  );
}

function badgeColors(theme: ReturnType<typeof useTheme>['theme'], tone: DigestBadge['tone']) {
  switch (tone) {
    case 'accent':
      return { bg: theme.accent, fg: theme.accentInk };
    case 'warn':
      return { bg: '#FDE68A', fg: '#92400E' };
    case 'success':
      return { bg: '#DCFCE7', fg: '#166534' };
    case 'private':
      return { bg: theme.surfaceMuted, fg: theme.inkSoft };
    case 'info':
    default:
      return { bg: theme.surfaceMuted, fg: theme.ink };
  }
}

export function DigestDetailScreen({
  heroTone = 'warm',
  eyebrow,
  headline,
  author,
  intro,
  tldr,
  sections = [],
  badges = [],
  disclaimerSlot,
  playerSlot,
  extraTopActions = [],
  customSections,
  scrollRef,
  onScrollBeginDrag,
  footerSlot,
  progress = 0.38,
  timeLeft = '4 min left',
  onBack,
  onMore,
  onBookmark,
  onShare,
  onCTAPress,
}: DigestDetailScreenProps) {
  const { theme } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Hero */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 320, zIndex: 0 }}>
        <Photo height={320} radius={0} tone={heroTone} label="hero · digest" />
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          <LinearGradient
            colors={['transparent', theme.bg]}
            locations={[0.4, 0.95]}
            style={{ width: '100%', height: '100%' }}
          />
        </View>
      </View>

      {/* Top buttons */}
      <View
        style={{
          position: 'absolute',
          top: 54,
          left: 14,
          right: 14,
          zIndex: 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Pressable
          onPress={onBack}
          accessibilityLabel="Go back"
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            backgroundColor: TOP_ACTION_BG,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="chevron-back" size={16} color={theme.ink} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {extraTopActions.map((a) => (
            <Pressable
              key={a.accessibilityLabel}
              onPress={a.onPress}
              accessibilityLabel={a.accessibilityLabel}
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: TOP_ACTION_BG,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={a.icon} size={16} color={theme.ink} />
            </Pressable>
          ))}
          <Pressable
            onPress={onBookmark}
            accessibilityLabel="Bookmark"
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: TOP_ACTION_BG,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="bookmark-outline" size={16} color={theme.ink} />
          </Pressable>
          <Pressable
            onPress={onShare}
            accessibilityLabel="Share"
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: TOP_ACTION_BG,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="share-outline" size={16} color={theme.ink} />
          </Pressable>
          <Pressable
            onPress={onMore}
            accessibilityLabel="More"
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: TOP_ACTION_BG,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="ellipsis-horizontal" size={16} color={theme.ink} />
          </Pressable>
        </View>
      </View>

      {/* Content */}
      <ScrollView
        ref={scrollRef}
        onScrollBeginDrag={onScrollBeginDrag}
        contentContainerStyle={{
          paddingTop: 230,
          paddingBottom: 120,
          paddingHorizontal: 22,
        }}
      >
        {eyebrow ? (
          <View
            style={{
              alignSelf: 'flex-start',
              backgroundColor: theme.accent,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 8,
            }}
          >
            <Text
              style={{
                color: theme.accentInk,
                fontFamily: 'Inter_700Bold',
                fontSize: 11,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
              }}
            >
              {eyebrow}
            </Text>
          </View>
        ) : null}
        <Text
          style={{
            marginTop: 12,
            marginBottom: 10,
            fontFamily: theme.serif,
            fontSize: 32,
            lineHeight: 33.3,
            letterSpacing: -0.9,
            color: theme.ink,
          }}
        >
          {headline}
        </Text>
        {author ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              marginBottom: 12,
            }}
          >
            <View style={{ width: 28, height: 28, borderRadius: 14, overflow: 'hidden' }}>
              <LinearGradient
                colors={[theme.accent, theme.pillBg]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ width: '100%', height: '100%' }}
              />
            </View>
            <View>
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: theme.ink }}>
                {author.name}
              </Text>
              {author.meta ? (
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: theme.inkSoft }}>
                  {author.meta}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {badges.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {badges.map((b) => {
              const c = badgeColors(theme, b.tone);
              return (
                <View
                  key={b.label}
                  style={{
                    backgroundColor: c.bg,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 6,
                  }}
                >
                  <Text
                    style={{
                      color: c.fg,
                      fontFamily: 'Inter_600SemiBold',
                      fontSize: 10.5,
                      letterSpacing: 0.4,
                      textTransform: 'uppercase',
                    }}
                  >
                    {b.label}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {disclaimerSlot ? <View style={{ marginBottom: 14 }}>{disclaimerSlot}</View> : null}

        {playerSlot ? <View style={{ marginBottom: 14 }}>{playerSlot}</View> : null}

        {/* TL;DR card (digest-specific) */}
        {tldr ? (
          <View
            style={{
              backgroundColor: theme.accentSoft,
              borderRadius: 14,
              padding: 14,
              marginBottom: 18,
            }}
          >
            <View
              style={{
                alignSelf: 'flex-start',
                backgroundColor: theme.accent,
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 6,
                marginBottom: 6,
              }}
            >
              <Text
                style={{
                  color: theme.accentInk,
                  fontFamily: 'Inter_700Bold',
                  fontSize: 10,
                  letterSpacing: 0.4,
                }}
              >
                TL;DR
              </Text>
            </View>
            <Text
              style={{
                fontFamily: 'Inter_400Regular',
                fontSize: 14,
                lineHeight: 20.3,
                color: theme.ink,
              }}
            >
              {tldr}
            </Text>
          </View>
        ) : null}

        {/* Drop-cap intro */}
        {intro ? (
          <View style={{ flexDirection: 'row' }}>
            <Text
              style={{
                fontFamily: theme.serif,
                fontSize: 56,
                lineHeight: 47.6,
                color: theme.accent,
                paddingTop: 6,
                paddingRight: 8,
              }}
            >
              {intro.charAt(0)}
            </Text>
            <Text
              style={{
                flex: 1,
                fontFamily: theme.serif,
                fontSize: 17,
                lineHeight: 26.35,
                color: theme.ink,
              }}
            >
              {intro.slice(1)}
            </Text>
          </View>
        ) : null}

        {/* Body — either a custom slot or default sections */}
        {customSections ?? <DigestPlainSections sections={sections} />}

        {footerSlot ? <View style={{ marginTop: 28 }}>{footerSlot}</View> : null}
      </ScrollView>

      <StickyCTA progress={progress} meta={timeLeft} onPress={onCTAPress} />
    </View>
  );
}
