import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '@/providers/theme-provider';

export interface DocumentReaderSection {
  id: string;
  heading: string;
  /** Body paragraphs. Each entry is a string OR an inline-highlighted span set. */
  paragraphs: Array<string | DocumentReaderParagraph>;
  /** Optional inline note rendered after the section. */
  note?: string;
}

export interface DocumentReaderParagraph {
  /** Plain text body. */
  text: string;
  /** Optional substring to highlight inline with accent-soft background. */
  highlight?: string;
}

export interface DocumentReaderScreenProps {
  eyebrow?: string;
  title: string;
  meta?: string;
  tldr?: { label?: string; minutes?: number; body: string };
  sections?: DocumentReaderSection[];
  onBack?: () => void;
  onBookmark?: () => void;
  onTextSize?: () => void;
  onAdd?: () => void;
}

export function DocumentReaderScreen({
  eyebrow = 'Constitutional Law · Case',
  title,
  meta,
  tldr,
  sections = [],
  onBack,
  onBookmark,
  onTextSize,
  onAdd,
}: DocumentReaderScreenProps) {
  const { theme } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Top gradient bar */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 100, zIndex: 5 }}>
        <LinearGradient
          colors={[theme.bg, `${theme.bg}cc`, 'transparent']}
          locations={[0, 0.7, 1]}
          style={{ width: '100%', height: '100%' }}
        />
      </View>
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
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.line,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="chevron-back" size={16} color={theme.ink} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPress={onBookmark}
            accessibilityLabel="Bookmark"
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.line,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="bookmark-outline" size={16} color={theme.ink} />
          </Pressable>
          <Pressable
            onPress={onTextSize}
            accessibilityLabel="Text size"
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.line,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontFamily: theme.serif, fontSize: 14, color: theme.ink }}>Aa</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingTop: 110,
          paddingBottom: 110,
          paddingHorizontal: 22,
        }}
      >
        <Text
          style={{
            fontFamily: 'Inter_700Bold',
            fontSize: 11,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            color: theme.accent,
          }}
        >
          {eyebrow}
        </Text>
        <Text
          style={{
            marginTop: 8,
            marginBottom: 6,
            fontFamily: theme.serif,
            fontSize: 30,
            lineHeight: 31.5,
            letterSpacing: -0.9,
            color: theme.ink,
          }}
        >
          {title}
        </Text>
        {meta ? (
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft }}>
            {meta}
          </Text>
        ) : null}

        {tldr ? (
          <>
            <View style={{ height: 18 }} />
            <View
              style={{
                backgroundColor: theme.accentSoft,
                borderRadius: 14,
                padding: 14,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <View
                  style={{
                    backgroundColor: theme.accent,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 6,
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
                    {tldr.label ?? 'TL;DR'}
                  </Text>
                </View>
                {tldr.minutes ? (
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: theme.inkSoft }}>
                    {tldr.minutes} minute
                  </Text>
                ) : null}
              </View>
              <Text
                style={{
                  fontFamily: 'Inter_400Regular',
                  fontSize: 14,
                  lineHeight: 20.3,
                  color: theme.ink,
                }}
              >
                {tldr.body}
              </Text>
            </View>
          </>
        ) : null}

        {sections.map((section) => (
          <View key={section.id} style={{ marginTop: 22 }}>
            <Text
              style={{
                marginBottom: 8,
                fontFamily: theme.serif,
                fontSize: 19,
                letterSpacing: -0.3,
                color: theme.ink,
              }}
            >
              {section.heading}
            </Text>
            {section.paragraphs.map((p, i) => {
              const para = typeof p === 'string' ? { text: p } : p;
              return (
                <Text
                  key={i}
                  style={{
                    fontFamily: theme.serif,
                    fontSize: 16,
                    lineHeight: 24.8,
                    color: theme.ink,
                    marginTop: i === 0 ? 0 : 14,
                  }}
                >
                  {para.highlight && para.text.includes(para.highlight) ? (
                    <>
                      {para.text.split(para.highlight)[0]}
                      <Text style={{ backgroundColor: theme.accentSoft }}>{para.highlight}</Text>
                      {para.text.split(para.highlight)[1]}
                    </>
                  ) : (
                    para.text
                  )}
                </Text>
              );
            })}
            {section.note ? (
              <View
                style={{
                  marginTop: 14,
                  borderLeftWidth: 3,
                  borderLeftColor: theme.accent,
                  paddingHorizontal: 12,
                  paddingVertical: 4,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Inter_400Regular',
                    fontSize: 13,
                    color: theme.inkSoft,
                    fontStyle: 'italic',
                  }}
                >
                  {section.note}
                </Text>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>

      {/* Floating action */}
      <Pressable
        onPress={onAdd}
        accessibilityLabel="Add note"
        style={{
          position: 'absolute',
          right: 18,
          bottom: 28,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: theme.accent,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.22,
          shadowRadius: 28,
          shadowOffset: { width: 0, height: 12 },
          elevation: 12,
        }}
      >
        <Ionicons name="add" size={26} color={theme.accentInk} />
      </Pressable>
    </View>
  );
}
