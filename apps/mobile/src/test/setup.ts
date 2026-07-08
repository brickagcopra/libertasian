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
  };
});

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
