import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Photo } from '@/components/ui/Photo';
import { TabBar, type TabBarItemId } from '@/components/ui/TabBar';
import { type PhotoTone } from '@/lib/design-tokens';
import { useTheme } from '@/providers/theme-provider';

export interface HomeFeedItem {
  id: string;
  category: string;
  headline: string;
  minutes: number;
  byline?: string;
  tone?: PhotoTone;
}

export interface HomeScreenProps {
  greetingDate?: string;
  greetingName?: string;
  greetingFollowup?: string;
  /** Today's brief card. */
  brief?: { eyebrow: string; title: string; onRead?: () => void; onSkip?: () => void };
  /** Reading streak in days. */
  streakDays?: number;
  /** 7 booleans (last week of reading days, oldest → newest). */
  streakWeek?: boolean[];
  /** Cards in the "For you" feed. */
  feed?: HomeFeedItem[];
  onSeeAllFeed?: () => void;
  onPressFeedItem?: (id: string) => void;
  onProfilePress?: () => void;
  /** Active tab id passed to the design's bottom TabBar. */
  activeTab?: TabBarItemId;
  onTabPress?: (id: TabBarItemId) => void;
}

const DEFAULT_FEED: HomeFeedItem[] = [
  {
    id: 'a',
    category: 'Contracts',
    headline: "The promise that wasn't: a guide to consideration",
    minutes: 6,
    byline: 'By Prof. Andrade',
    tone: 'sage',
  },
  {
    id: 'b',
    category: 'Con Law',
    headline: 'How the Fourth Amendment meets your phone',
    minutes: 9,
    byline: 'By Prof. Andrade',
    tone: 'plum',
  },
];

export function HomeScreen({
  greetingDate = 'Tuesday, May 6',
  greetingName = 'Hi there.',
  greetingFollowup = 'Ready?',
  brief = {
    eyebrow: "Today's brief · 4 min",
    title: 'When does a tweet become a contract?',
  },
  streakDays = 12,
  streakWeek = [true, true, true, true, true, false, true],
  feed = DEFAULT_FEED,
  onSeeAllFeed,
  onPressFeedItem,
  onProfilePress,
  activeTab = 'home',
  onTabPress,
}: HomeScreenProps) {
  const { theme } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: 60,
          paddingBottom: 110,
          paddingHorizontal: 18,
        }}
      >
        {/* Greeting + avatar */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft }}>
              {greetingDate}
            </Text>
            <Text
              style={{
                fontFamily: theme.serif,
                fontSize: 28,
                lineHeight: 30.8,
                letterSpacing: -0.6,
                color: theme.ink,
              }}
            >
              {greetingName}{' '}
              <Text style={{ color: theme.inkFaint }}>{greetingFollowup}</Text>
            </Text>
          </View>
          <Pressable onPress={onProfilePress} accessibilityLabel="Open profile">
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                borderWidth: 2,
                borderColor: theme.surface,
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
        </View>

        <View style={{ height: 18 }} />

        {/* Daily brief card */}
        <View
          style={{
            backgroundColor: theme.pillBg,
            borderRadius: 22,
            padding: 18,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <View
            style={{
              position: 'absolute',
              right: -20,
              top: -20,
              width: 130,
              height: 130,
              borderRadius: 65,
              backgroundColor: theme.accent,
              opacity: 0.95,
            }}
          />
          <View>
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 11,
                letterSpacing: 1,
                textTransform: 'uppercase',
                color: theme.pillInk,
                opacity: 0.7,
              }}
            >
              {brief.eyebrow}
            </Text>
            <Text
              style={{
                fontFamily: theme.serif,
                fontSize: 24,
                lineHeight: 26.4,
                letterSpacing: -0.6,
                color: theme.pillInk,
                marginTop: 6,
                maxWidth: 240,
              }}
            >
              {brief.title}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <Pressable
                onPress={brief.onRead}
                style={{
                  backgroundColor: theme.accent,
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                }}
              >
                <Text
                  style={{
                    color: theme.accentInk,
                    fontFamily: 'Inter_600SemiBold',
                    fontSize: 13,
                  }}
                >
                  Read brief →
                </Text>
              </Pressable>
              <Pressable
                onPress={brief.onSkip}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.18)',
                }}
              >
                <Text
                  style={{
                    color: theme.pillInk,
                    fontFamily: 'Inter_500Medium',
                    fontSize: 13,
                  }}
                >
                  Skip
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={{ height: 22 }} />

        {/* Streak strip */}
        <View
          style={{
            backgroundColor: theme.surface,
            borderRadius: 16,
            padding: 14,
            borderWidth: 1,
            borderColor: theme.line,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: theme.inkSoft }}>
              Reading streak
            </Text>
            <Text style={{ fontFamily: theme.serif, fontSize: 20, color: theme.ink }}>
              {streakDays} days <Text style={{ color: theme.accent }}>🔥</Text>
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {streakWeek.map((on, i) => (
              <View
                key={i}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  backgroundColor: on ? theme.accent : theme.surfaceMuted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {on ? (
                  <Text
                    style={{
                      color: theme.accentInk,
                      fontSize: 9,
                      fontFamily: 'Inter_700Bold',
                    }}
                  >
                    ✓
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>

        <View style={{ height: 24 }} />

        {/* For you section */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <Text
            style={{
              fontFamily: theme.serif,
              fontSize: 22,
              letterSpacing: -0.4,
              color: theme.ink,
            }}
          >
            For you
          </Text>
          <Pressable onPress={onSeeAllFeed}>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft }}>
              See all
            </Text>
          </Pressable>
        </View>

        <View style={{ gap: 14 }}>
          {feed.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => onPressFeedItem?.(item.id)}
              style={{
                backgroundColor: theme.surface,
                borderRadius: 18,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: theme.line,
              }}
            >
              <Photo
                height={220}
                radius={0}
                tone={item.tone ?? 'warm'}
                label={`photo · ${item.category.toLowerCase()}`}
              />
              <View style={{ padding: 16, marginTop: -120 }}>
                <View style={{ height: 116 }} />
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
                    {item.category}
                  </Text>
                </View>
                <Text
                  style={{
                    fontFamily: theme.serif,
                    fontSize: 19,
                    lineHeight: 21.85,
                    letterSpacing: -0.3,
                    color: theme.ink,
                    marginTop: 10,
                  }}
                >
                  {item.headline}
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    marginTop: 10,
                  }}
                >
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: theme.inkSoft }}>
                    {item.minutes} min read
                  </Text>
                  {item.byline ? (
                    <>
                      <Text style={{ color: theme.inkFaint, fontSize: 12 }}>·</Text>
                      <Text
                        style={{
                          fontFamily: 'Inter_400Regular',
                          fontSize: 12,
                          color: theme.inkSoft,
                        }}
                      >
                        {item.byline}
                      </Text>
                    </>
                  ) : null}
                </View>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <TabBar active={activeTab} onPress={onTabPress} />
    </View>
  );
}
