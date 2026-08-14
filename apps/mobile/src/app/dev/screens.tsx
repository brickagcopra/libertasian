import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  DigestDetailScreen,
  DocumentReaderScreen,
  HomeScreen,
  LibraryScreen,
  LoginScreen,
  OnboardingScreen,
  ProfileScreen,
  SearchScreen,
  SignupScreen,
} from '@/components/screens';
import { THEMES, type ThemeKey } from '@/lib/design-tokens';
import { useTheme } from '@/providers/theme-provider';

type ScreenId =
  | 'onboarding'
  | 'login'
  | 'signup'
  | 'home'
  | 'library'
  | 'doc-reader'
  | 'digest'
  | 'search'
  | 'profile';

const SCREEN_OPTIONS: { id: ScreenId; label: string }[] = [
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'login', label: 'Login' },
  { id: 'signup', label: 'Signup' },
  { id: 'home', label: 'Home' },
  { id: 'library', label: 'Library' },
  { id: 'doc-reader', label: 'Doc reader' },
  { id: 'digest', label: 'Digest detail' },
  { id: 'search', label: 'Search' },
  { id: 'profile', label: 'Profile' },
];

/**
 * Component gallery — development only.
 *
 * `app/dev/*` are real expo-router routes with no production exclusion, so this
 * placeholder gallery was reachable inside shipping builds (App Store guideline
 * 2.1). Nothing links to it, but "unreachable" is not "absent". Rendering null
 * outside `__DEV__` leaves the route registered and empty in release builds.
 */
export default function ScreensGallery() {
  const { theme, themeKey, setTheme } = useTheme();
  const [active, setActive] = useState<ScreenId>('onboarding');

  if (!__DEV__) return null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Top toolbar — theme switch + screen picker */}
      <View
        style={{
          paddingTop: 50,
          paddingHorizontal: 16,
          paddingBottom: 12,
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.line,
        }}
      >
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
              fontSize: 22,
              letterSpacing: -0.4,
              color: theme.ink,
            }}
          >
            Screen gallery
          </Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {(['A', 'B'] as const).map((key) => {
              const t = THEMES[key];
              const sel = themeKey === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setTheme(key as ThemeKey)}
                  accessibilityLabel={`Switch to ${t.name}`}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: sel ? theme.pillBg : theme.chipBg,
                  }}
                >
                  <Text
                    style={{
                      color: sel ? theme.pillInk : theme.ink,
                      fontFamily: 'Inter_600SemiBold',
                      fontSize: 12,
                    }}
                  >
                    {t.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {SCREEN_OPTIONS.map((opt) => {
            const sel = active === opt.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() => setActive(opt.id)}
                style={{
                  paddingHorizontal: 12,
                  height: 30,
                  borderRadius: 999,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: sel ? theme.accent : theme.chipBg,
                }}
              >
                <Text
                  style={{
                    color: sel ? theme.accentInk : theme.ink,
                    fontFamily: 'Inter_500Medium',
                    fontSize: 12,
                  }}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Active screen preview */}
      <View style={{ flex: 1 }}>{renderScreen(active)}</View>
    </View>
  );
}

function renderScreen(id: ScreenId) {
  switch (id) {
    case 'onboarding':
      return <OnboardingScreen />;
    case 'login':
      return <LoginScreen />;
    case 'signup':
      return <SignupScreen />;
    case 'home':
      return <HomeScreen greetingName="Hi Maya." />;
    case 'library':
      return <LibraryScreen />;
    case 'doc-reader':
      return (
        <DocumentReaderScreen
          title="Marbury v. Madison"
          meta="5 U.S. 137 · 1803 · 8 min read"
          tldr={{
            body: 'The Court can strike down laws that violate the Constitution. This is the case that gave courts that power.',
            minutes: 1,
          }}
          sections={[
            {
              id: 'facts',
              heading: 'Facts',
              paragraphs: [
                {
                  text: 'William Marbury was promised a job as a justice of the peace by outgoing President Adams. The new Secretary of State, James Madison, refused to deliver his commission. Marbury sued, asking the Supreme Court to force Madison to hand it over.',
                  highlight: 'Marbury sued, asking the Supreme Court to force Madison to hand it over.',
                },
              ],
              note: 'You highlighted this on Apr 28',
            },
            {
              id: 'holding',
              heading: 'Holding',
              paragraphs: [
                "Yes, Marbury had a right to the commission — but no, the Court couldn't help him here. The statute giving the Court that power was unconstitutional.",
              ],
            },
          ]}
        />
      );
    case 'digest':
      return (
        <DigestDetailScreen
          eyebrow="Op-ed · Civil Liberties"
          headline="The quiet erosion of the Fourth Amendment."
          author={{ name: 'Lina Park', meta: 'May 4 · 7 min' }}
          tldr="Cell-site location data, doorbell cameras, and connected appliances have outpaced a doctrine built for letters and locked rooms."
          intro="The warrant requirement was built for a world of letters and locked rooms. It was not built for a phone that maps your every step, a doorbell that watches the street, or a fridge that knows what time you wake up."
          sections={[
            {
              id: 'facts',
              heading: 'Facts',
              paragraphs: [
                'Courts have spent the last decade trying to update the doctrine, one piece of consumer hardware at a time.',
              ],
            },
            {
              id: 'issues',
              heading: 'Issues',
              paragraphs: [
                'Whether the third-party doctrine survives the era of always-on data sharing, and what counts as a "search" when the data was collected by someone else.',
              ],
            },
            {
              id: 'ruling',
              heading: 'Ruling',
              paragraphs: [
                'In Carpenter v. United States, the Court held that the government generally needs a warrant to access historical cell-site location records held by a wireless carrier.',
              ],
            },
          ]}
        />
      );
    case 'search':
      return (
        <SearchScreen
          query="fourth amendment phone"
          smartAnswer={{
            body: 'Carpenter v. United States (2018) held that police generally need a warrant to obtain historical cell-site location data from your carrier.',
            citations: 3,
            verified: true,
          }}
        />
      );
    case 'profile':
      return (
        <ProfileScreen
          identity={{ name: 'Maya Reyes', subtitle: '2L · Stanford Law · Bar prep' }}
          plan={{ name: 'Student', price: '$9/mo', renewsOn: 'June 1' }}
        />
      );
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}
