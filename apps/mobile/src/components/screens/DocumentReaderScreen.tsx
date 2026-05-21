import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '@/providers/theme-provider';

export interface DocumentReaderSection {
  id: string;
  heading: string;
  /** Body paragraphs. Each entry is a string OR an inline-highlighted span set. */
  paragraphs: Array<string | DocumentReaderParagraph>;
  /** Optional inline note rendered after the section. */
  note?: string;
  /** Original page range in the source document, surfaced as a small tag. */
  pageStart?: number | null;
  pageEnd?: number | null;
}

export interface DocumentReaderParagraph {
  /** Plain text body. */
  text: string;
  /** Optional substring to highlight inline with accent-soft background. */
  highlight?: string;
}

export interface DocumentReaderCitation {
  id: string;
  /** Display text (e.g. "Riley v. California, 573 U.S. 373 (2014)"). */
  citationText: string;
  /** Optional surrounding sentence the citation appears in. */
  context?: string | null;
  /** Optional cited-document title for linkable citations. */
  citedTitle?: string | null;
  onPress?: () => void;
}

export interface DocumentReaderRelated {
  id: string;
  title: string;
  subtitle?: string | null;
  /** 0..1 relevance score; rendered as a faint chip if present. */
  relevance?: number | null;
  onPress?: () => void;
}

export interface DocumentReaderTopAction {
  /** Ionicons glyph name. */
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  /** Optional badge rendered as a small accent dot (e.g. saved-offline). */
  badge?: boolean;
  onPress?: () => void;
}

export interface DocumentReaderScreenProps {
  eyebrow?: string;
  title: string;
  meta?: string;
  tldr?: { label?: string; minutes?: number; body: string };
  sections?: DocumentReaderSection[];
  /** Provenance/trust banner rendered below the meta (e.g. ContentDisclaimer). */
  disclaimerSlot?: ReactNode;
  /** Slot rendered below the disclaimer/meta block, above the TLDR (e.g. "View existing digest" CTA). */
  belowMetaSlot?: ReactNode;
  /** Extra top-right action buttons rendered before the bookmark + text-size cluster. */
  extraTopActions?: DocumentReaderTopAction[];
  /** Citation list rendered as a collapsible card after the sections. */
  citations?: DocumentReaderCitation[];
  citationsLoading?: boolean;
  /** Related-documents list rendered as a collapsible card after citations. */
  relatedDocuments?: DocumentReaderRelated[];
  relatedLoading?: boolean;
  onBack?: () => void;
  onBookmark?: () => void;
  /** Pressed visual when the document is bookmarked. Defaults to the filled bookmark glyph. */
  isBookmarked?: boolean;
  onTextSize?: () => void;
  onAdd?: () => void;
}

function pageRangeText(s: DocumentReaderSection): string | null {
  if (!s.pageStart) return null;
  if (s.pageEnd && s.pageEnd !== s.pageStart) return `p. ${s.pageStart}–${s.pageEnd}`;
  return `p. ${s.pageStart}`;
}

export function DocumentReaderScreen({
  eyebrow = 'Constitutional Law · Case',
  title,
  meta,
  tldr,
  sections = [],
  disclaimerSlot,
  belowMetaSlot,
  extraTopActions = [],
  citations,
  citationsLoading = false,
  relatedDocuments,
  relatedLoading = false,
  onBack,
  onBookmark,
  isBookmarked = false,
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
          {extraTopActions.map((a) => (
            <Pressable
              key={a.accessibilityLabel}
              onPress={a.onPress}
              accessibilityLabel={a.accessibilityLabel}
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
              <Ionicons name={a.icon} size={16} color={theme.ink} />
              {a.badge ? (
                <View
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.accent,
                  }}
                />
              ) : null}
            </Pressable>
          ))}
          <Pressable
            onPress={onBookmark}
            accessibilityLabel={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
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
            <Ionicons
              name={isBookmarked ? 'bookmark' : 'bookmark-outline'}
              size={16}
              color={isBookmarked ? theme.accent : theme.ink}
            />
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

        {disclaimerSlot ? <View style={{ marginTop: 14 }}>{disclaimerSlot}</View> : null}
        {belowMetaSlot ? <View style={{ marginTop: 12 }}>{belowMetaSlot}</View> : null}

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

        {sections.map((section) => {
          const range = pageRangeText(section);
          return (
            <View key={section.id} style={{ marginTop: 22 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <Text
                  style={{
                    fontFamily: theme.serif,
                    fontSize: 19,
                    letterSpacing: -0.3,
                    color: theme.ink,
                  }}
                >
                  {section.heading}
                </Text>
                {range ? (
                  <Text
                    style={{
                      fontFamily: 'Inter_500Medium',
                      fontSize: 11,
                      letterSpacing: 0.4,
                      color: theme.inkFaint,
                    }}
                  >
                    {range}
                  </Text>
                ) : null}
              </View>
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
          );
        })}

        {/* Citations card — rendered after the sections when citations exist or are loading. */}
        {citations !== undefined ? (
          <View
            style={{
              marginTop: 28,
              padding: 16,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: theme.line,
              backgroundColor: theme.surface,
            }}
          >
            <Text
              style={{
                fontFamily: 'Inter_700Bold',
                fontSize: 11,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                color: theme.accent,
                marginBottom: 6,
              }}
            >
              Citations · {citations.length}
            </Text>
            {citationsLoading ? (
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft }}>
                Loading citations…
              </Text>
            ) : citations.length === 0 ? (
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft }}>
                No citations recorded for this document.
              </Text>
            ) : (
              citations.map((c, i) => (
                <Pressable
                  key={c.id}
                  onPress={c.onPress}
                  style={{
                    paddingVertical: 12,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: theme.line,
                  }}
                >
                  <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: theme.ink }}>
                    {c.citationText}
                  </Text>
                  {c.citedTitle ? (
                    <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: theme.inkSoft, marginTop: 2 }}>
                      {c.citedTitle}
                    </Text>
                  ) : null}
                  {c.context ? (
                    <Text
                      style={{
                        fontFamily: theme.serif,
                        fontSize: 13,
                        color: theme.inkSoft,
                        marginTop: 6,
                        fontStyle: 'italic',
                      }}
                      numberOfLines={3}
                    >
                      “{c.context}”
                    </Text>
                  ) : null}
                </Pressable>
              ))
            )}
          </View>
        ) : null}

        {/* Related documents card. */}
        {relatedDocuments !== undefined ? (
          <View
            style={{
              marginTop: 16,
              padding: 16,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: theme.line,
              backgroundColor: theme.surface,
            }}
          >
            <Text
              style={{
                fontFamily: 'Inter_700Bold',
                fontSize: 11,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                color: theme.accent,
                marginBottom: 6,
              }}
            >
              Related · {relatedDocuments.length}
            </Text>
            {relatedLoading ? (
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft }}>
                Loading related documents…
              </Text>
            ) : relatedDocuments.length === 0 ? (
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft }}>
                No related documents found.
              </Text>
            ) : (
              relatedDocuments.map((r, i) => (
                <Pressable
                  key={r.id}
                  onPress={r.onPress}
                  style={{
                    paddingVertical: 12,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: theme.line,
                  }}
                >
                  <Text style={{ fontFamily: theme.serif, fontSize: 16, color: theme.ink, letterSpacing: -0.2 }}>
                    {r.title}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 }}>
                    {r.subtitle ? (
                      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: theme.inkSoft }}>
                        {r.subtitle}
                      </Text>
                    ) : null}
                    {typeof r.relevance === 'number' ? (
                      <View
                        style={{
                          backgroundColor: theme.accentSoft,
                          paddingHorizontal: 6,
                          paddingVertical: 1,
                          borderRadius: 4,
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: 'Inter_600SemiBold',
                            fontSize: 10,
                            color: theme.accent,
                            letterSpacing: 0.4,
                          }}
                        >
                          {Math.round(r.relevance * 100)}% match
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              ))
            )}
          </View>
        ) : null}
      </ScrollView>

      {/* Floating action — rendered only when an onAdd handler is provided.
          Reader hides this for codal-class documents (no digest generation). */}
      {onAdd ? (
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
      ) : null}
    </View>
  );
}
