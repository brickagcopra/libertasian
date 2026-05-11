import { fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { ThemeProvider, useTheme } from '@/providers/theme-provider';

jest.mock('react-native-mmkv', () => {
  const store = new Map<string, string>();
  return {
    MMKV: jest.fn().mockImplementation(() => ({
      getString: (k: string) => store.get(k),
      set: (k: string, v: string) => store.set(k, v),
      getBoolean: () => undefined,
      getNumber: () => undefined,
      delete: (k: string) => store.delete(k),
      contains: (k: string) => store.has(k),
      clearAll: () => store.clear(),
    })),
    __resetStore: () => store.clear(),
  };
});

function ThemeProbe() {
  const { theme, themeKey, toggleTheme, setTheme } = useTheme();
  return (
    <>
      <Text testID="key">{themeKey}</Text>
      <Text testID="name">{theme.name}</Text>
      <Pressable testID="toggle" onPress={toggleTheme}>
        <Text>toggle</Text>
      </Pressable>
      <Pressable testID="set-a" onPress={() => setTheme('A')}>
        <Text>set a</Text>
      </Pressable>
      <Pressable testID="set-b" onPress={() => setTheme('B')}>
        <Text>set b</Text>
      </Pressable>
    </>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    // Reset the in-memory MMKV store between tests.
    const mmkv = require('react-native-mmkv');
    if (mmkv.__resetStore) mmkv.__resetStore();
  });

  it('defaults to theme B (Confident Modern)', () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(getByTestId('key').props.children).toBe('B');
    expect(getByTestId('name').props.children).toBe('Confident Modern');
  });

  it('toggleTheme flips B → A → B', () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(getByTestId('key').props.children).toBe('B');
    fireEvent.press(getByTestId('toggle'));
    expect(getByTestId('key').props.children).toBe('A');
    fireEvent.press(getByTestId('toggle'));
    expect(getByTestId('key').props.children).toBe('B');
  });

  it('setTheme persists the explicit choice', () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    fireEvent.press(getByTestId('set-a'));
    expect(getByTestId('key').props.children).toBe('A');
    expect(getByTestId('name').props.children).toBe('Warm Editorial');
    fireEvent.press(getByTestId('set-b'));
    expect(getByTestId('key').props.children).toBe('B');
    expect(getByTestId('name').props.children).toBe('Confident Modern');
  });

  it('useTheme returns a default object when called outside provider', () => {
    const { getByTestId } = render(<ThemeProbe />);
    expect(getByTestId('key').props.children).toBe('B');
  });
});
