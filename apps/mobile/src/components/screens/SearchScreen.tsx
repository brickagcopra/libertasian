import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip } from '@/components/ui/Chip';
import { HeaderAmbient } from '@/components/ui/HeaderAmbient';
import { TabBar, type TabBarItemId } from '@/components/ui/TabBar';
import { photoTones, type PhotoTone } from '@/lib/design-tokens';
import { topInsetPadding, bottomInsetPaddingStacked } from '@/lib/safe-area';
import { useTheme } from '@/providers/theme-provider';

export type SearchResultKind = 'CASE' | 'ARTICLE' | 'OUTLINE' | 'STATUTE';

export interface SearchResult {
  id: string;
  kind: SearchResultKind;
  /** Precise badge text (e.g. "DECISION"). Falls back to `kind` when absent. */
  kindLabel?: string;
  title: string;
  subtitle: string;
  tone?: PhotoTone;
}

export interface SmartAnswer {
  body: string;
  citations?: number;
  verified?: boolean;
}

export interface SearchScreenProps {
  query?: string;
  onChangeQuery?: (q: string) => void;
  onSubmitQuery?: () => void;
  onClearQuery?: () => void;
  onCancel?: () => void;
  filters?: string[];
  activeFilter?: string;
  onFilterChange?: (filter: string) => void;
  smartAnswer?: SmartAnswer | null;
  results?: SearchResult[];
  onPressResult?: (id: string) => void;
  /** Per-result trailing action (e.g. "Generate digest"). Rendered to the right of each result. */
  renderResultAction?: (id: string) => ReactNode;
  /** Optional results-list heading override (defaults to "Top results"). */
  resultsHeading?: string;
  /** Slot rendered between filter chips and the results list (used for the SearchTabBar). */
  belowFiltersSlot?: ReactNode;
  /** When provided, replaces the default results list (used by AI Summary / Digests sub-tabs). */
  customResults?: ReactNode;
  /** Rendered when the query is empty — recent searches list. */
  historySlot?: ReactNode;
  /** Rendered when the query is empty — recently viewed grid. */
  recentlyViewedSlot?: ReactNode;
  /** Hide the "Cancel" button on the right of the search bar (used inside (tabs)/search). */
  hideCancel?: boolean;
  activeTab?: TabBarItemId;
  onTabPress?: (id: TabBarItemId) => void;
}

const DEFAULT_FILTERS = ['All', 'Cases', 'Articles', 'Statutes', 'Outlines'];

const DEFAULT_RESULTS: SearchResult[] = [
  { id: 'r1', kind: 'CASE', title: 'Carpenter v. United States', subtitle: '585 U.S. ___ · 2018', tone: 'warm' },
  { id: 'r2', kind: 'CASE', title: 'Riley v. California', subtitle: '573 U.S. 373 · 2014', tone: 'cool' },
  { id: 'r3', kind: 'ARTICLE', title: 'Why your phone is "papers and effects"', subtitle: 'Lina Park · 7 min', tone: 'plum' },
  { id: 'r4', kind: 'OUTLINE', title: '4A: searches & seizures (2024)', subtitle: 'Outline · 22 pages', tone: 'sage' },
];

export function SearchScreen({
  query = '',
  onChangeQuery,
  onSubmitQuery,
  onClearQuery,
  onCancel,
  filters = DEFAULT_FILTERS,
  activeFilter = DEFAULT_FILTERS[0],
  onFilterChange,
  smartAnswer,
  results = DEFAULT_RESULTS,
  onPressResult,
  renderResultAction,
  resultsHeading = 'Top results',
  belowFiltersSlot,
  customResults,
  historySlot,
  recentlyViewedSlot,
  hideCancel = false,
  activeTab = 'search',
  onTabPress,
}: SearchScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [internalQuery, setInternalQuery] = useState(query);
  const effectiveQuery = onChangeQuery ? query : internalQuery;
  const setQuery = (next: string) => {
    if (onChangeQuery) onChangeQuery(next);
    else setInternalQuery(next);
  };
  const clearQuery = () => {
    if (onClearQuery) onClearQuery();
    else setQuery('');
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <HeaderAmbient />
      <ScrollView
        contentContainerStyle={{
          paddingTop: topInsetPadding(insets, 54),
          paddingBottom: bottomInsetPaddingStacked(insets, 110),
          paddingHorizontal: 18,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View
            style={{
              flex: 1,
              height: 48,
              borderRadius: 14,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.line,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 14,
              gap: 10,
            }}
          >
            <Ionicons name="search" size={16} color={theme.ink} />
            <TextInput
              value={effectiveQuery}
              onChangeText={setQuery}
              onSubmitEditing={onSubmitQuery}
              placeholder="Search cases, articles, statutes…"
              placeholderTextColor={theme.inkFaint}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              style={{
                flex: 1,
                fontFamily: 'Inter_400Regular',
                fontSize: 14,
                color: theme.ink,
                paddingVertical: 0,
              }}
            />
            {effectiveQuery ? (
              <Pressable onPress={clearQuery} accessibilityLabel="Clear search" hitSlop={8}>
                <Ionicons name="close" size={14} color={theme.inkFaint} />
              </Pressable>
            ) : null}
          </View>
          {hideCancel ? null : (
            <Pressable onPress={onCancel}>
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  fontSize: 14,
                  color: theme.ink,
                }}
              >
                Cancel
              </Text>
            </Pressable>
          )}
        </View>

        <View style={{ height: 14 }} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {filters.map((f) => (
            <Chip
              key={f}
              label={f}
              selected={f === activeFilter}
              onPress={() => onFilterChange?.(f)}
            />
          ))}
        </ScrollView>

        <View style={{ height: 18 }} />

        {smartAnswer ? (
          <View
            style={{
              backgroundColor: theme.pillBg,
              borderRadius: 18,
              padding: 16,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: theme.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="sparkles" size={12} color={theme.accentInk} />
              </View>
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  fontSize: 12,
                  color: theme.pillInk,
                  opacity: 0.85,
                  letterSpacing: 0.4,
                }}
              >
                QUICK ANSWER
              </Text>
            </View>
            <Text
              style={{
                fontFamily: theme.serif,
                fontSize: 17,
                lineHeight: 23.8,
                letterSpacing: -0.2,
                color: theme.pillInk,
              }}
            >
              {smartAnswer.body}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
              {smartAnswer.citations ? (
                <View
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.12)',
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 8,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'Inter_500Medium',
                      fontSize: 12,
                      color: theme.pillInk,
                    }}
                  >
                    {smartAnswer.citations} cases cited
                  </Text>
                </View>
              ) : null}
              {smartAnswer.verified ? (
                <View
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.12)',
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 8,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'Inter_500Medium',
                      fontSize: 12,
                      color: theme.pillInk,
                    }}
                  >
                    Verified
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {belowFiltersSlot ? (
          <>
            <View style={{ height: 14 }} />
            {belowFiltersSlot}
          </>
        ) : null}

        <View style={{ height: 22 }} />

        {/*
         * Results region. Order of precedence:
         *   1. customResults (e.g. AI Summary tab, Digests tab)
         *   2. empty-query slots (history + recently viewed)
         *   3. default results list
         */}
        {customResults ? (
          customResults
        ) : !effectiveQuery && (historySlot || recentlyViewedSlot) ? (
          <>
            {historySlot}
            {historySlot && recentlyViewedSlot ? <View style={{ height: 16 }} /> : null}
            {recentlyViewedSlot}
          </>
        ) : (
          <>
            <Text
              style={{
                fontFamily: theme.serif,
                fontSize: 18,
                letterSpacing: -0.3,
                color: theme.ink,
                marginBottom: 12,
              }}
            >
              {resultsHeading}
            </Text>
            <View style={{ gap: 10 }}>
              {results.map((r) => {
                const tone = r.tone ?? 'warm';
                const palette = photoTones[tone];
                return (
                  <Pressable
                    key={r.id}
                    onPress={() => onPressResult?.(r.id)}
                    style={{
                      backgroundColor: theme.surface,
                      borderRadius: 14,
                      padding: 12,
                      borderWidth: 1,
                      borderColor: theme.line,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <View style={{ width: 40, height: 50, borderRadius: 6, overflow: 'hidden' }}>
                      <LinearGradient
                        colors={[palette[0], palette[1]]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{ width: '100%', height: '100%' }}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={{
                          fontFamily: 'Inter_700Bold',
                          fontSize: 10,
                          letterSpacing: 0.6,
                          color: theme.accent,
                        }}
                      >
                        {r.kindLabel ?? r.kind}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={{
                          fontFamily: theme.serif,
                          fontSize: 15,
                          letterSpacing: -0.2,
                          color: theme.ink,
                          marginTop: 2,
                        }}
                      >
                        {r.title}
                      </Text>
                      <Text
                        style={{
                          fontFamily: 'Inter_400Regular',
                          fontSize: 12,
                          color: theme.inkSoft,
                          marginTop: 2,
                        }}
                      >
                        {r.subtitle}
                      </Text>
                    </View>
                    {renderResultAction ? renderResultAction(r.id) : null}
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
      <TabBar active={activeTab} onPress={onTabPress} />
    </View>
  );
}
