import { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SyllabusTopic, SyllabusTopicProgress } from '../types';

interface TopicNodeProps {
  topic: SyllabusTopic;
  progress: Record<string, SyllabusTopicProgress>;
  onToggle: (topicId: string, currentStatus: string) => void;
  depth: number;
}

function TopicNode({ topic, progress, onToggle, depth }: TopicNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const topicProgress = progress[topic.id];
  const isCompleted = topicProgress?.status === 'completed';
  const isInProgress = topicProgress?.status === 'in_progress';
  const hasChildren = topic.children && topic.children.length > 0;

  const childCompletionText = useMemo(() => {
    if (!hasChildren || !topic.children) return '';
    const completed = topic.children.filter(
      (c) => progress[c.id]?.status === 'completed',
    ).length;
    return `${completed}/${topic.children.length}`;
  }, [hasChildren, topic.children, progress]);

  return (
    <View style={{ marginLeft: depth > 0 ? 16 : 0 }}>
      <View style={styles.row}>
        {/* Checkbox */}
        <TouchableOpacity
          onPress={() => onToggle(topic.id, topicProgress?.status ?? 'not_started')}
          style={styles.checkboxTouchArea}
        >
          <Ionicons
            name={isCompleted ? 'checkbox' : 'square-outline'}
            size={20}
            color={isCompleted ? '#4f46e5' : '#d1d5db'}
          />
        </TouchableOpacity>

        {/* Expand/Collapse for parents */}
        {hasChildren ? (
          <TouchableOpacity
            onPress={() => setExpanded(!expanded)}
            style={styles.expandButton}
          >
            <Ionicons
              name={expanded ? 'chevron-down' : 'chevron-forward'}
              size={16}
              color="#6b7280"
            />
          </TouchableOpacity>
        ) : (
          <View style={styles.expandPlaceholder} />
        )}

        {/* Title */}
        <View style={styles.titleContainer}>
          <Text
            style={[
              styles.title,
              isCompleted && styles.titleCompleted,
              isInProgress && styles.titleInProgress,
              depth === 0 && styles.titleBold,
            ]}
            numberOfLines={2}
          >
            {topic.title}
          </Text>
        </View>

        {/* Status indicator */}
        {hasChildren && childCompletionText ? (
          <Text style={styles.childCount}>{childCompletionText}</Text>
        ) : isInProgress ? (
          <View style={styles.inProgressBadge}>
            <Text style={styles.inProgressText}>In Progress</Text>
          </View>
        ) : null}
      </View>

      {/* Children */}
      {hasChildren && expanded && (
        <View style={styles.childrenContainer}>
          {topic.children!.map((child) => (
            <TopicNode
              key={child.id}
              topic={child}
              progress={progress}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function buildTopicTree(topics: SyllabusTopic[]): SyllabusTopic[] {
  const topLevel = topics.filter((t) => !t.parentTopicId);
  const childMap = new Map<string, SyllabusTopic[]>();

  for (const topic of topics) {
    if (topic.parentTopicId) {
      const siblings = childMap.get(topic.parentTopicId) ?? [];
      siblings.push(topic);
      childMap.set(topic.parentTopicId, siblings);
    }
  }

  return topLevel.map((parent) => ({
    ...parent,
    children: (childMap.get(parent.id) ?? []).sort((a, b) => a.ordering - b.ordering),
  }));
}

interface SyllabusTopicTreeProps {
  topics: SyllabusTopic[];
  progress: Record<string, SyllabusTopicProgress>;
  onToggle: (topicId: string, currentStatus: string) => void;
}

export function SyllabusTopicTree({ topics, progress, onToggle }: SyllabusTopicTreeProps) {
  const tree = useMemo(() => buildTopicTree(topics), [topics]);

  if (tree.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No topics defined yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {tree.map((topic) => (
        <TopicNode
          key={topic.id}
          topic={topic}
          progress={progress}
          onToggle={onToggle}
          depth={0}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 4,
  },
  checkboxTouchArea: {
    padding: 4,
  },
  expandButton: {
    padding: 4,
    width: 24,
    alignItems: 'center',
  },
  expandPlaceholder: {
    width: 24,
  },
  titleContainer: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    color: '#111827',
    lineHeight: 20,
  },
  titleBold: {
    fontWeight: '600',
  },
  titleCompleted: {
    textDecorationLine: 'line-through',
    color: '#9ca3af',
  },
  titleInProgress: {
    color: '#1d4ed8',
  },
  childCount: {
    fontSize: 11,
    color: '#6b7280',
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  inProgressBadge: {
    backgroundColor: '#dbeafe',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  inProgressText: {
    fontSize: 10,
    color: '#1d4ed8',
    fontWeight: '500',
  },
  childrenContainer: {
    borderLeftWidth: 1,
    borderLeftColor: '#e5e7eb',
    marginLeft: 14,
  },
  empty: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
  },
});
