import { useState, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useDigestCount } from '../hooks/use-search-digests';
import type { SearchTab } from '../types';

interface SearchTabsProps {
  activeTab: SearchTab;
  onTabChange: (tab: SearchTab) => void;
  resultCount?: number;
  query: string | null;
}

interface TabConfig {
  key: SearchTab;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}

const TABS: TabConfig[] = [
  { key: 'fulltext', label: 'Full Text', icon: 'document-text-outline' },
  { key: 'ai-summary', label: 'AI Summary', icon: 'sparkles-outline' },
  { key: 'digests', label: 'Digests', icon: 'book-outline' },
];

export function SearchTabBar({
  activeTab,
  onTabChange,
  resultCount,
  query,
}: SearchTabsProps) {
  // Same query key as the Digests tab's list, so this is one request, not two.
  const { data: digestCount } = useDigestCount(query ?? '', !!query);

  return (
    <View style={styles.container}>
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        const badgeCount =
          tab.key === 'fulltext' && resultCount && resultCount > 0
            ? resultCount
            : tab.key === 'digests' && typeof digestCount === 'number' && digestCount > 0
              ? digestCount
              : null;

        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, isActive ? styles.tabActive : null]}
            onPress={() => onTabChange(tab.key)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={tab.icon}
              size={16}
              color={isActive ? '#1a56db' : '#6b7280'}
            />
            <Text style={[styles.tabLabel, isActive ? styles.tabLabelActive : null]}>
              {tab.label}
            </Text>
            {badgeCount !== null ? (
              <View style={[styles.badge, isActive ? styles.badgeActive : null]}>
                <Text style={[styles.badgeText, isActive ? styles.badgeTextActive : null]}>
                  {badgeCount > 999 ? '999+' : badgeCount.toString()}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingHorizontal: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#1a56db',
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6b7280',
  },
  tabLabelActive: {
    color: '#1a56db',
    fontWeight: '600',
  },
  badge: {
    backgroundColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: 'center',
  },
  badgeActive: {
    backgroundColor: '#dbeafe',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6b7280',
  },
  badgeTextActive: {
    color: '#1a56db',
  },
});
