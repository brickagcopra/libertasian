/* eslint-disable @typescript-eslint/no-empty-function */

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock expo-router
jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(false),
  },
  Link: ({ children }: { children: React.ReactNode }) => children,
  // Screens configure their native header with <Stack.Screen options={...} />.
  // It renders nothing itself, so a null-returning stub is enough to let a
  // screen mount under RNTL — without it every such screen throws on
  // "Cannot read properties of undefined (reading 'Screen')".
  Stack: Object.assign(
    ({ children }: { children?: React.ReactNode }) => children ?? null,
    { Screen: () => null },
  ),
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
  useLocalSearchParams: () => ({}),
  useSegments: () => [],
}));

// Mock expo-sharing
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock expo-av — the audio player streams via Audio.Sound; the native module
// (ExponentAV) is undefined under jest, so provide a loadable sound stub.
jest.mock('expo-av', () => {
  const createSoundStub = () => ({
    playAsync: jest.fn().mockResolvedValue({ isLoaded: true }),
    pauseAsync: jest.fn().mockResolvedValue({ isLoaded: true }),
    unloadAsync: jest.fn().mockResolvedValue({ isLoaded: false }),
    setPositionAsync: jest.fn().mockResolvedValue({ isLoaded: true }),
    setRateAsync: jest.fn().mockResolvedValue({ isLoaded: true }),
    getStatusAsync: jest.fn().mockResolvedValue({ isLoaded: true, isPlaying: false }),
    setOnPlaybackStatusUpdate: jest.fn(),
  });
  return {
    Audio: {
      setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
      Sound: {
        createAsync: jest.fn().mockImplementation(() =>
          Promise.resolve({ sound: createSoundStub(), status: { isLoaded: true } }),
        ),
      },
    },
    // audio-session passes the interruption modes explicitly; without these
    // enums on the mock the import resolves to undefined and every suite that
    // reaches a player fails to load.
    InterruptionModeIOS: { MixWithOthers: 0, DoNotMix: 1, DuckOthers: 2 },
    InterruptionModeAndroid: { DoNotMix: 1, DuckOthers: 2 },
  };
});

// Mock expo/fetch — the transport behind the AI-answer stream client. Importing
// it binds to the native ExpoFetchModule, which is undefined under jest, so any
// suite that transitively reaches `features/ai-answers/stream-ai-answer` would
// fail to load. Suites that actually exercise streaming re-declare this mock
// locally and drive the response themselves.
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

// Mock expo-notifications — importing the real package pulls the `expo`
// entrypoint whose expo-asset PlatformUtils needs the native Expo global
// (undefined under jsdom, same issue as @expo/vector-icons below).
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync: jest
    .fn()
    .mockResolvedValue({ data: 'ExponentPushToken[test]' }),
  addNotificationResponseReceivedListener: jest
    .fn()
    .mockReturnValue({ remove: jest.fn() }),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  AndroidImportance: { DEFAULT: 3, MAX: 5 },
}));

// Mock expo-device — tests run off-device; keeps push registration a no-op.
jest.mock('expo-device', () => ({
  isDevice: false,
}));

// Mock expo-constants
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      // Mirrors app.json: `version` is what api-client sends as X-App-Version.
      version: '1.0.0',
      extra: {
        apiUrl: 'http://localhost:3001/api/v1',
      },
    },
  },
}));

// Mock react-native Alert
jest.mock('react-native/Libraries/Alert/Alert', () => ({
  alert: jest.fn(),
}));

// Mock expo-apple-authentication — native Sign in with Apple module is
// undefined under jest; tests drive signInAsync per-case.
jest.mock('expo-apple-authentication', () => ({
  signInAsync: jest.fn(),
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

// Mock @react-native-google-signin/google-signin — same reason; signIn
// resolves the v13 { type, data } shape in individual tests.
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn(),
    signOut: jest.fn().mockResolvedValue(undefined),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));

// Mock @expo/vector-icons — its transitive expo-font/expo-asset imports
// reach into native PlatformUtils (Expo global) which is undefined under jsdom.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const makeIconFamily = (family: string) =>
    function IconFamilyMock(props: { name?: string; testID?: string }) {
      return React.createElement(Text, { testID: props.testID ?? `icon-${family}-${props.name ?? ''}` }, props.name ?? '');
    };
  return new Proxy(
    {},
    {
      get: (_t, prop: string) => makeIconFamily(prop),
    },
  );
});

// Suppress noisy warnings in test output
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const message = typeof args[0] === 'string' ? args[0] : '';
  if (message.includes('Animated:') || message.includes('NativeAnimatedHelper')) {
    return;
  }
  originalWarn.call(console, ...args);
};

// react-native-safe-area-context has no provider under jsdom, so
// useSafeAreaInsets() throws "No safe area value available". Production DOES
// have one — expo-router's ExpoRoot mounts a real <SafeAreaProvider> — and on
// an API 36 emulator it measures top=54.1. Mock it globally with plausible
// non-zero insets so every screen that respects the safe area is testable
// without each suite re-declaring the same mock.
//
// SafeAreaView is passed through as a plain View: on iOS the real component
// applies padding natively, which jsdom cannot reproduce either way.
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const insets = { top: 44, bottom: 34, left: 0, right: 0 };
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(View, props, children),
    SafeAreaInsetsContext: React.createContext(insets),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
    initialWindowMetrics: { frame: { x: 0, y: 0, width: 390, height: 844 }, insets },
  };
});
