import { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  useMyVote,
  useRemoveVote,
  useUpsertVote,
} from '../hooks/use-community-votes';
import type { VoteType } from '../types';

interface VoteButtonsProps {
  entityType: string;
  entityId: string;
  voteScore?: number;
}

export function VoteButtons({
  entityType,
  entityId,
  voteScore,
}: VoteButtonsProps) {
  const { data: myVoteRes } = useMyVote(entityType, entityId);
  const upsertVote = useUpsertVote();
  const removeVote = useRemoveVote();

  // Bare { success, data } envelope — already unwrapped by `apiClient`.
  const myVote = myVoteRes ?? null;
  const isUpvoted = myVote?.voteType === 'up';
  const isDownvoted = myVote?.voteType === 'down';
  const isPending = upsertVote.isPending || removeVote.isPending;

  const handleVote = useCallback(
    (voteType: VoteType) => {
      if (isPending) return;
      if (myVote?.voteType === voteType) {
        removeVote.mutate({ entityType, entityId });
      } else {
        upsertVote.mutate({ entityType, entityId, voteType });
      }
    },
    [entityType, entityId, myVote, isPending, removeVote, upsertVote],
  );

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.button, isUpvoted && styles.upActive]}
        onPress={() => handleVote('up')}
        disabled={isPending}
        activeOpacity={0.6}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Ionicons
          name={isUpvoted ? 'thumbs-up' : 'thumbs-up-outline'}
          size={16}
          color={isUpvoted ? '#15803d' : '#6b7280'}
        />
      </TouchableOpacity>

      {voteScore != null && (
        <Text
          style={[
            styles.score,
            voteScore > 0 && styles.scorePositive,
            voteScore < 0 && styles.scoreNegative,
          ]}
        >
          {voteScore}
        </Text>
      )}

      <TouchableOpacity
        style={[styles.button, isDownvoted && styles.downActive]}
        onPress={() => handleVote('down')}
        disabled={isPending}
        activeOpacity={0.6}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Ionicons
          name={isDownvoted ? 'thumbs-down' : 'thumbs-down-outline'}
          size={16}
          color={isDownvoted ? '#dc2626' : '#6b7280'}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  button: {
    padding: 6,
    borderRadius: 6,
  },
  upActive: {
    backgroundColor: '#f0fdf4',
  },
  downActive: {
    backgroundColor: '#fef2f2',
  },
  score: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    minWidth: 20,
    textAlign: 'center',
  },
  scorePositive: {
    color: '#15803d',
  },
  scoreNegative: {
    color: '#dc2626',
  },
});
