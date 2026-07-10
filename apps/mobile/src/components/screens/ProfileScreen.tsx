import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { HeaderAmbient } from '@/components/ui/HeaderAmbient';
import { TabBar, type TabBarItemId } from '@/components/ui/TabBar';
import { THEMES, type ThemeKey } from '@/lib/design-tokens';
import { useTheme } from '@/providers/theme-provider';

export interface ProfileStat {
  value: string;
  label: string;
}

export interface ProfileRow {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  onPress?: () => void;
}

export interface ProfilePlan {
  name: string;
  price: string;
  renewsOn?: string;
  onManage?: () => void;
}

export interface ProfileScreenProps {
  identity: {
    name: string;
    initial?: string;
    subtitle?: string;
    avatarUrl?: string;
  };
  stats?: ProfileStat[];
  plan?: ProfilePlan;
  rows?: ProfileRow[];
  onSettingsPress?: () => void;
  /** Currently selected theme key (kept in sync with provider when omitted). */
  themeKey?: ThemeKey;
  /** Called when the user taps the look-and-feel switcher. */
  onChangeTheme?: (key: ThemeKey) => void;
  activeTab?: TabBarItemId;
  onTabPress?: (id: TabBarItemId) => void;
}

const DEFAULT_STATS: ProfileStat[] = [
  { value: '142', label: 'Read' },
  { value: '12', label: 'Day streak' },
  { value: '24', label: 'Saved' },
];

const DEFAULT_ROWS: ProfileRow[] = [
  { id: 'highlights', icon: 'bookmark-outline', label: 'My highlights', sub: '24 saved' },
  { id: 'add-doc', icon: 'add-circle-outline', label: 'Add document' },
  { id: 'reading-prefs', icon: 'reader-outline', label: 'Reading prefs', sub: 'Serif · Med' },
  { id: 'notifications', icon: 'notifications-outline', label: 'Notifications', sub: 'Daily brief' },
  { id: 'about', icon: 'information-circle-outline', label: 'About Libertasian' },
];

export function ProfileScreen({
  identity,
  stats = DEFAULT_STATS,
  plan,
  rows = DEFAULT_ROWS,
  onSettingsPress,
  themeKey: themeKeyProp,
  onChangeTheme,
  activeTab = 'me',
  onTabPress,
}: ProfileScreenProps) {
  const { theme, themeKey: providerKey, setTheme } = useTheme();
  const activeThemeKey = themeKeyProp ?? providerKey;

  const handleThemeChange = (next: ThemeKey) => {
    if (onChangeTheme) onChangeTheme(next);
    else setTheme(next);
  };

  const initial = identity.initial ?? identity.name.charAt(0).toUpperCase();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <HeaderAmbient />
      <ScrollView
        contentContainerStyle={{
          paddingTop: 60,
          paddingBottom: 110,
          paddingHorizontal: 18,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text
            style={{
              fontFamily: theme.serif,
              fontSize: 30,
              letterSpacing: -0.8,
              color: theme.ink,
            }}
          >
            Me
          </Text>
          <Pressable
            onPress={onSettingsPress}
            accessibilityLabel="Open settings"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.line,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="settings-outline" size={18} color={theme.ink} />
          </Pressable>
        </View>

        <View style={{ height: 18 }} />

        {/* Identity card */}
        <View
          style={{
            backgroundColor: theme.surface,
            borderRadius: 22,
            padding: 18,
            borderWidth: 1,
            borderColor: theme.line,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, overflow: 'hidden' }}>
              <LinearGradient
                colors={[theme.accent, theme.pillBg]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  width: '100%',
                  height: '100%',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    fontFamily: theme.serif,
                    fontSize: 26,
                    color: '#fff',
                  }}
                >
                  {initial}
                </Text>
              </LinearGradient>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: theme.serif,
                  fontSize: 22,
                  letterSpacing: -0.3,
                  color: theme.ink,
                }}
              >
                {identity.name}
              </Text>
              {identity.subtitle ? (
                <Text
                  style={{
                    marginTop: 2,
                    fontFamily: 'Inter_400Regular',
                    fontSize: 13,
                    color: theme.inkSoft,
                  }}
                >
                  {identity.subtitle}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 14, marginTop: 16 }}>
            {stats.map((s) => (
              <View key={s.label} style={{ flex: 1 }}>
                <Text style={{ fontFamily: theme.serif, fontSize: 22, color: theme.ink }}>
                  {s.value}
                </Text>
                <Text
                  style={{
                    fontFamily: 'Inter_500Medium',
                    fontSize: 11,
                    color: theme.inkSoft,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                  }}
                >
                  {s.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ height: 22 }} />

        {plan ? (
          <View
            style={{
              backgroundColor: theme.pillBg,
              borderRadius: 18,
              padding: 16,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <View
              style={{
                position: 'absolute',
                right: -10,
                top: -10,
                width: 90,
                height: 90,
                borderRadius: 45,
                backgroundColor: theme.accent,
                opacity: 0.95,
              }}
            />
            <Text
              style={{
                fontFamily: 'Inter_700Bold',
                fontSize: 11,
                letterSpacing: 0.6,
                color: theme.pillInk,
                opacity: 0.7,
              }}
            >
              YOUR PLAN
            </Text>
            <Text
              style={{
                marginTop: 4,
                fontFamily: theme.serif,
                fontSize: 22,
                letterSpacing: -0.4,
                color: theme.pillInk,
              }}
            >
              {plan.name} · {plan.price}
            </Text>
            {plan.renewsOn ? (
              <Text
                style={{
                  marginTop: 4,
                  fontFamily: 'Inter_400Regular',
                  fontSize: 12,
                  color: theme.pillInk,
                  opacity: 0.7,
                }}
              >
                Renews on {plan.renewsOn}
              </Text>
            ) : null}
            <View style={{ height: 14 }} />
            <Pressable
              onPress={plan.onManage}
              style={{
                alignSelf: 'flex-start',
                backgroundColor: theme.accent,
                paddingHorizontal: 14,
                paddingVertical: 8,
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
                Manage plan
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={{ height: 22 }} />

        {/* Theme switcher */}
        <View
          style={{
            backgroundColor: theme.surface,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: theme.line,
            padding: 16,
          }}
        >
          <Text
            style={{
              fontFamily: 'Inter_500Medium',
              fontSize: 12,
              color: theme.inkSoft,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
            }}
          >
            Look &amp; feel
          </Text>
          <Text
            style={{
              marginTop: 4,
              fontFamily: theme.serif,
              fontSize: 18,
              letterSpacing: -0.3,
              color: theme.ink,
            }}
          >
            Choose your aesthetic
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            {(['A', 'B'] as const).map((key) => {
              const t = THEMES[key];
              const isActive = activeThemeKey === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => handleThemeChange(key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={t.name}
                  style={{
                    flex: 1,
                    borderRadius: 14,
                    padding: 12,
                    borderWidth: 2,
                    borderColor: isActive ? theme.ink : theme.line,
                    backgroundColor: t.bg,
                  }}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      backgroundColor: t.accent,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: t.accentInk, fontFamily: t.serif, fontSize: 17 }}>L</Text>
                  </View>
                  <Text
                    style={{
                      marginTop: 8,
                      fontFamily: t.serif,
                      fontSize: 15,
                      color: t.ink,
                      letterSpacing: -0.2,
                    }}
                  >
                    {t.name}
                  </Text>
                  <Text
                    style={{
                      marginTop: 2,
                      fontFamily: 'Inter_400Regular',
                      fontSize: 11,
                      color: t.inkSoft,
                    }}
                  >
                    {key === 'A' ? 'Cream · amber · serif' : 'Off-white · lime · clean'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ height: 22 }} />

        {/* Settings rows */}
        <View
          style={{
            backgroundColor: theme.surface,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: theme.line,
            overflow: 'hidden',
          }}
        >
          {rows.map((row, i) => (
            <Pressable
              key={row.id}
              onPress={row.onPress}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                paddingVertical: 14,
                paddingHorizontal: 16,
                borderBottomWidth: i < rows.length - 1 ? 1 : 0,
                borderBottomColor: theme.line,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: theme.surfaceMuted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={row.icon} size={16} color={theme.ink} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: 'Inter_500Medium',
                    fontSize: 14,
                    color: theme.ink,
                  }}
                >
                  {row.label}
                </Text>
                {row.sub ? (
                  <Text
                    style={{
                      fontFamily: 'Inter_400Regular',
                      fontSize: 12,
                      color: theme.inkSoft,
                    }}
                  >
                    {row.sub}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={14} color={theme.inkFaint} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <TabBar active={activeTab} onPress={onTabPress} />
    </View>
  );
}
