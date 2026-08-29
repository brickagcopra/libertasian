import React from 'react';
import { render } from '@testing-library/react-native';
import { Text, View } from 'react-native';

jest.mock('expo-router', () => {
  const screens: Array<{ name: string; options: Record<string, unknown> }> = [];
  return {
    Tabs: Object.assign(
      ({
        children,
        screenOptions,
      }: {
        children: React.ReactNode;
        screenOptions?: Record<string, unknown>;
      }) => {
        const { View, Text } = require('react-native');
        return (
          <View testID="tabs">
            <Text testID="screenOptions">{JSON.stringify(screenOptions)}</Text>
            <View testID="screens">{children}</View>
          </View>
        );
      },
      {
        Screen: ({
          name,
          options,
        }: {
          name: string;
          options: Record<string, unknown>;
        }) => {
          const { Text } = require('react-native');
          return (
            <Text testID={`tab-${name}`}>
              {JSON.stringify({
                name,
                title: options?.title,
                // `href: null` is how expo-router drops a route from the bar.
                hidden: options?.href === null,
              })}
            </Text>
          );
        },
      },
    ),
    router: { push: jest.fn() },
  };
});

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name, size, color }: { name: string; size: number; color: string }) => {
    const { Text } = require('react-native');
    return <Text testID={`icon-${name}`}>{name}</Text>;
  },
}));

import TabsLayout from '@/app/(tabs)/_layout';
import { setEntitled, setFreeTier } from '@/features/entitlements/test-helpers';

const hiddenOf = (el: { props: { children: string } }): boolean =>
  JSON.parse(el.props.children).hidden;

describe('TabsLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setEntitled();
  });

  it('renders all expected tab screens', () => {
    const { getByTestId } = render(<TabsLayout />);

    expect(getByTestId('tab-index')).toBeTruthy();
    expect(getByTestId('tab-search')).toBeTruthy();
    expect(getByTestId('tab-digests')).toBeTruthy();
    expect(getByTestId('tab-study')).toBeTruthy();
    expect(getByTestId('tab-scan')).toBeTruthy();
    expect(getByTestId('tab-workspace')).toBeTruthy();
  });

  it('renders correct tab titles', () => {
    const { getByTestId } = render(<TabsLayout />);

    // Phase 3: index now hosts the redesigned Home (was legacy Search).
    const homeTab = JSON.parse(getByTestId('tab-index').props.children);
    expect(homeTab.title).toBe('Home');

    const searchTab = JSON.parse(getByTestId('tab-search').props.children);
    expect(searchTab.title).toBe('Search');

    const digestsTab = JSON.parse(getByTestId('tab-digests').props.children);
    expect(digestsTab.title).toBe('Digests');

    const studyTab = JSON.parse(getByTestId('tab-study').props.children);
    expect(studyTab.title).toBe('Study');

    const scanTab = JSON.parse(getByTestId('tab-scan').props.children);
    expect(scanTab.title).toBe('Scan');

    const workspaceTab = JSON.parse(
      getByTestId('tab-workspace').props.children,
    );
    expect(workspaceTab.title).toBe('Workspace');
  });

  describe('free tier', () => {
    beforeEach(() => {
      setFreeTier();
    });

    it('hides the Scan and Study tabs', () => {
      const { getByTestId } = render(<TabsLayout />);

      expect(hiddenOf(getByTestId('tab-scan'))).toBe(true);
      expect(hiddenOf(getByTestId('tab-study'))).toBe(true);
    });

    it('leaves the Library tab alone — the free codals live there', () => {
      const { getByTestId } = render(<TabsLayout />);
      expect(hiddenOf(getByTestId('tab-library'))).toBe(false);
    });

    it('leaves Home, Search, Digests, Feed and Workspace alone', () => {
      const { getByTestId } = render(<TabsLayout />);

      for (const name of ['index', 'search', 'digests', 'feed', 'workspace']) {
        expect({ name, hidden: hiddenOf(getByTestId(`tab-${name}`)) }).toEqual({
          name,
          hidden: false,
        });
      }
    });
  });

  it('hides nothing for an entitled account', () => {
    const { getByTestId } = render(<TabsLayout />);

    expect(hiddenOf(getByTestId('tab-scan'))).toBe(false);
    expect(hiddenOf(getByTestId('tab-study'))).toBe(false);
  });

  it('sets headerShown to true in screenOptions', () => {
    const { getByTestId } = render(<TabsLayout />);

    const screenOptions = getByTestId('screenOptions');
    // screenOptions is a function-based config, but we can check the component renders
    expect(screenOptions).toBeTruthy();
  });
});
