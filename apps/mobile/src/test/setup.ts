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

// Suppress noisy warnings in test output
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const message = typeof args[0] === 'string' ? args[0] : '';
  if (message.includes('Animated:') || message.includes('NativeAnimatedHelper')) {
    return;
  }
  originalWarn.call(console, ...args);
};
