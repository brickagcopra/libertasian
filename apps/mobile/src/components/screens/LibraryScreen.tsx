import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Chip } from '@/components/ui/Chip';
import { TabBar, type TabBarItemId } from '@/components/ui/TabBar';
import { photoTones, type PhotoTone } from '@/lib/design-tokens';
import { useTheme } from '@/providers/theme-provider';

export interface LibraryItem {
  id: string;
  title: string;
  subtitle: string;
  tone?: PhotoTone;
}

export interface LibrarySection {
  id: string;
  title: string;
  items: LibraryItem[];
  onSeeAll?: () => void;
}

export interface LibraryFeatured {
  eyebrow: string;
  title: string;
  subtitle: string;
  onPress?: () => void;
}

export interface LibraryScreenProps {
  filterCategories?: string[];
  activeFilter?: string;
  onFilterChange?: (filter: string) => void;
  searchPlaceholder?: string;
  /** Tap to open a search modal. Used when searchValue/onSearchChange aren't passed. */
  onSearchPress?: () => void;
  /** Controlled search input. When provided, the search field becomes editable. */
  searchValue?: string;
  onSearchChange?: (q: string) => void;
  onSearchSubmit?: () => void;
  onSearchClear?: () => void;
  featured?: LibraryFeatured;
  sections?: LibrarySection[];
  onPressItem?: (sectionId: string, itemId: string) => void;
  onPressFilter?: () => void;
  /** Optional badge count rendered on the filter button (advanced filters active). */
  filterCount?: number;
  /** Optional pull-to-refresh state. */
  refreshing?: boolean;
  onRefresh?: () => void;
  activeTab?: TabBarItemId;
  onTabPress?: (id: TabBarItemId) => void;
  /** Top content padding. Default compensates for headerless routes; pass a small value under a native header. */
  contentTopPadding?: number;
}

const DEFAULT_FILTERS = ['All', 'Cases', 'Statutes', 'Outlines', 'My uploads', 'Saved'];

const DEFAULT_FEATURED: LibraryFeatured = {
  eyebrow: 'Pack of the week',
  title: 'Constitutional Law in 14 days',
  subtitle: '32 cases · 5 essays · 1 outline',
};

const DEFAULT_SECTIONS: LibrarySection[] = [
  {
    id: 'founding',
    title: 'Founding documents',
    items: [
      { id: 'us-const', title: 'U.S. Constitution', subtitle: 'Annotated · 12 articles', tone: 'warm' },
      { id: 'bor', title: 'Bill of Rights', subtitle: 'Annotated · 10 amendments', tone: 'cool' },
    ],
  },
  {
    id: 'casebooks',
    title: 'Casebooks',
    items: [
      { id: 'marbury', title: 'Marbury v. Madison', subtitle: '5 U.S. 137 (1803)', tone: 'sage' },
      { id: 'brown', title: 'Brown v. Board', subtitle: '347 U.S. 483 (1954)', tone: 'plum' },
      { id: 'roe', title: 'Roe v. Wade', subtitle: '410 U.S. 113 (1973)', tone: 'sand' },
    ],
  },
];

export function LibraryScreen({
  filterCategories = DEFAULT_FILTERS,
  activeFilter = DEFAULT_FILTERS[0],
  onFilterChange,
  searchPlaceholder = 'Search 12,000+ cases & statutes',
  onSearchPress,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  onSearchClear,
  featured = DEFAULT_FEATURED,
  sections = DEFAULT_SECTIONS,
  onPressItem,
  onPressFilter,
  filterCount = 0,
  refreshing = false,
  onRefresh,
  activeTab = 'docs',
  onTabPress,
  contentTopPadding = 60,
}: LibraryScreenProps) {
  const { theme } = useTheme();
  const isControlledSearch = onSearchChange !== undefined;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: contentTopPadding,
          paddingBottom: 110,
          paddingHorizontal: 18,
        }}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.ink} />
          ) : undefined
        }
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text
            style={{
              fontFamily: theme.serif,
              fontSize: 30,
              letterSpacing: -0.8,
              color: theme.ink,
            }}
          >
            Library
          </Text>
          <Pressable
            onPress={onPressFilter}
            accessibilityLabel="Filter"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: filterCount > 0 ? theme.accentSoft : theme.surface,
              borderWidth: 1,
              borderColor: filterCount > 0 ? theme.accent : theme.line,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name="options-outline"
              size={18}
              color={filterCount > 0 ? theme.accent : theme.ink}
            />
            {filterCount > 0 ? (
              <View
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  paddingHorizontal: 4,
                  backgroundColor: theme.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    color: theme.accentInk,
                    fontFamily: 'Inter_700Bold',
                    fontSize: 10,
                  }}
                >
                  {filterCount}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        <View style={{ height: 14 }} />

        {/* Search field — TextInput when controlled, Pressable-stub otherwise. */}
        {isControlledSearch ? (
          <View
            style={{
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
            <Ionicons name="search" size={16} color={theme.inkFaint} />
            <TextInput
              value={searchValue ?? ''}
              onChangeText={onSearchChange}
              onSubmitEditing={onSearchSubmit}
              placeholder={searchPlaceholder}
              placeholderTextColor={theme.inkFaint}
              returnKeyType="search"
              style={{
                flex: 1,
                fontFamily: 'Inter_400Regular',
                fontSize: 14,
                color: theme.ink,
                paddingVertical: 0,
              }}
            />
            {searchValue && searchValue.length > 0 ? (
              <Pressable onPress={onSearchClear} accessibilityLabel="Clear search" hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={theme.inkFaint} />
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Pressable
            onPress={onSearchPress}
            style={{
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
            <Ionicons name="search" size={16} color={theme.inkFaint} />
            <Text
              style={{
                flex: 1,
                fontFamily: 'Inter_400Regular',
                fontSize: 14,
                color: theme.inkFaint,
              }}
            >
              {searchPlaceholder}
            </Text>
            <View
              style={{
                backgroundColor: theme.surfaceMuted,
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 4,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Inter_500Medium',
                  fontSize: 11,
                  color: theme.inkSoft,
                }}
              >
                ⌘K
              </Text>
            </View>
          </Pressable>
        )}

        <View style={{ height: 16 }} />

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {filterCategories.map((c) => (
            <Chip
              key={c}
              label={c}
              selected={c === activeFilter}
              onPress={() => onFilterChange?.(c)}
            />
          ))}
        </ScrollView>

        <View style={{ height: 22 }} />

        {/* Featured banner */}
        <Pressable
          onPress={featured.onPress}
          style={{
            backgroundColor: theme.accentSoft,
            borderRadius: 18,
            padding: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            overflow: 'hidden',
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: 'Inter_700Bold',
                fontSize: 11,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                color: theme.accent,
              }}
            >
              {featured.eyebrow}
            </Text>
            <Text
              style={{
                marginTop: 6,
                fontFamily: theme.serif,
                fontSize: 19,
                lineHeight: 21.85,
                letterSpacing: -0.3,
                color: theme.ink,
              }}
            >
              {featured.title}
            </Text>
            <Text
              style={{
                marginTop: 4,
                fontFamily: 'Inter_400Regular',
                fontSize: 12,
                color: theme.inkSoft,
              }}
            >
              {featured.subtitle}
            </Text>
          </View>
          <View
            style={{
              width: 78,
              height: 100,
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <LinearGradient
              colors={[theme.accent, theme.pillBg]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: '100%', height: '100%' }}
            />
          </View>
        </Pressable>

        <View style={{ height: 22 }} />

        {sections.map((section) => (
          <View key={section.id} style={{ marginBottom: 22 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <Text
                style={{
                  fontFamily: theme.serif,
                  fontSize: 19,
                  letterSpacing: -0.3,
                  color: theme.ink,
                }}
              >
                {section.title}
              </Text>
              <Pressable onPress={section.onSeeAll}>
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: theme.inkSoft }}>
                  See all
                </Text>
              </Pressable>
            </View>
            <View style={{ gap: 10 }}>
              {section.items.map((it) => {
                const tone = it.tone ?? 'warm';
                const palette = photoTones[tone];
                return (
                  <Pressable
                    key={it.id}
                    onPress={() => onPressItem?.(section.id, it.id)}
                    style={{
                      backgroundColor: theme.surface,
                      borderWidth: 1,
                      borderColor: theme.line,
                      borderRadius: 14,
                      padding: 12,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <View
                      style={{
                        width: 50,
                        height: 64,
                        borderRadius: 8,
                        overflow: 'hidden',
                      }}
                    >
                      <LinearGradient
                        colors={[palette[0], theme.pillBg]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{ width: '100%', height: '100%' }}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        numberOfLines={2}
                        style={{
                          fontFamily: theme.serif,
                          fontSize: 16,
                          lineHeight: 19,
                          letterSpacing: -0.2,
                          color: theme.ink,
                        }}
                      >
                        {it.title}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={{
                          marginTop: 2,
                          fontFamily: 'Inter_400Regular',
                          fontSize: 12,
                          color: theme.inkSoft,
                        }}
                      >
                        {it.subtitle}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={theme.inkFaint} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
      <TabBar active={activeTab} onPress={onTabPress} />
    </View>
  );
}
