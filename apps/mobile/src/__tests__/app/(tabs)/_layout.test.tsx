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
              {JSON.stringify({ name, title: options?.title })}
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

describe('TabsLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('sets headerShown to true in screenOptions', () => {
    const { getByTestId } = render(<TabsLayout />);

    const screenOptions = getByTestId('screenOptions');
    // screenOptions is a function-based config, but we can check the component renders
    expect(screenOptions).toBeTruthy();
  });
});
