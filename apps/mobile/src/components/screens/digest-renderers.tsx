import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/providers/theme-provider';

/**
 * Bespoke renderers for non-case-digest types. Each renders inside the design's
 * digest-detail body shell — they replace the default Facts/Issues/Ruling list.
 */

export interface IracBlocks {
  issue: string | null;
  rule: string | null;
  application: string | null;
  conclusion: string | null;
}

export function IracDigestRenderer({ issue, rule, application, conclusion }: IracBlocks) {
  const { theme } = useTheme();
  const items: Array<[string, string | null]> = [
    ['Issue', issue],
    ['Rule', rule],
    ['Application', application],
    ['Conclusion', conclusion],
  ];

  return (
    <View style={{ marginTop: 8 }}>
      {items.map(([label, body]) =>
        body ? (
          <View
            key={label}
            style={{
              marginTop: 18,
              paddingHorizontal: 14,
              paddingVertical: 14,
              borderRadius: 14,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.line,
            }}
          >
            <Text
              style={{
                fontFamily: 'Inter_700Bold',
                fontSize: 11,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                color: theme.accent,
                marginBottom: 6,
              }}
            >
              {label}
            </Text>
            <Text
              style={{
                fontFamily: theme.serif,
                fontSize: 16,
                lineHeight: 24.8,
                color: theme.ink,
              }}
            >
              {body}
            </Text>
          </View>
        ) : null,
      )}
    </View>
  );
}

const CHOICE_LETTERS = ['A', 'B', 'C', 'D'] as const;

export interface McqBlocks {
  stem: string;
  choices: (string | null)[];
  correctChoice: string | null;
  explanation: string | null;
}

export function McqDigestRenderer({ stem, choices, correctChoice, explanation }: McqBlocks) {
  const { theme } = useTheme();
  const [revealed, setRevealed] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const handleChoiceTap = (idx: number) => {
    if (revealed) return;
    setSelectedIdx(idx);
    setRevealed(true);
  };

  return (
    <View style={{ marginTop: 18 }}>
      <Text
        style={{
          fontFamily: theme.serif,
          fontSize: 17,
          lineHeight: 26.35,
          color: theme.ink,
          marginBottom: 14,
        }}
      >
        {stem}
      </Text>
      {choices.map((choice, idx) => {
        if (!choice) return null;
        const letter = CHOICE_LETTERS[idx]!;
        const isCorrect = correctChoice === letter;
        const isSelected = selectedIdx === idx;
        const showResult = revealed;

        const correctBg = '#16A34A';
        const wrongBg = '#DC2626';

        const surfaceBorder =
          showResult && isCorrect
            ? correctBg
            : showResult && isSelected && !isCorrect
              ? wrongBg
              : theme.line;

        return (
          <Pressable
            key={letter}
            onPress={() => handleChoiceTap(idx)}
            disabled={revealed}
            accessibilityRole="button"
            accessibilityLabel={`Choice ${letter}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 12,
              marginBottom: 10,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: surfaceBorder,
              backgroundColor: theme.surface,
            }}
          >
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor:
                  showResult && isCorrect
                    ? correctBg
                    : showResult && isSelected && !isCorrect
                      ? wrongBg
                      : theme.surfaceMuted,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={{
                  fontFamily: 'Inter_700Bold',
                  fontSize: 13,
                  color:
                    showResult && (isCorrect || (isSelected && !isCorrect))
                      ? '#FFFFFF'
                      : theme.ink,
                }}
              >
                {letter}
              </Text>
            </View>
            <Text
              style={{
                flex: 1,
                fontFamily: 'Inter_400Regular',
                fontSize: 14,
                lineHeight: 20,
                color: theme.ink,
              }}
            >
              {choice}
            </Text>
          </Pressable>
        );
      })}
      {revealed && explanation ? (
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            marginTop: 6,
            padding: 12,
            borderRadius: 12,
            backgroundColor: theme.accentSoft,
          }}
        >
          <Ionicons name="bulb-outline" size={16} color={theme.accent} />
          <Text
            style={{
              flex: 1,
              fontFamily: 'Inter_400Regular',
              fontSize: 13,
              lineHeight: 19,
              color: theme.ink,
            }}
          >
            {explanation}
          </Text>
        </View>
      ) : null}
      {revealed ? (
        <Pressable
          onPress={() => {
            setRevealed(false);
            setSelectedIdx(null);
          }}
          style={{ alignSelf: 'flex-start', marginTop: 12, paddingVertical: 8, paddingHorizontal: 12 }}
        >
          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: theme.accent }}>
            Try again
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface EssayBlocks {
  prompt: string;
  modelAnswer: string | null;
}

export function EssayDigestRenderer({ prompt, modelAnswer }: EssayBlocks) {
  const { theme } = useTheme();
  const [revealed, setRevealed] = useState(false);

  return (
    <View style={{ marginTop: 18 }}>
      <View
        style={{
          padding: 14,
          borderRadius: 14,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.line,
        }}
      >
        <Text
          style={{
            fontFamily: 'Inter_700Bold',
            fontSize: 11,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: theme.accent,
            marginBottom: 6,
          }}
        >
          Prompt
        </Text>
        <Text
          style={{
            fontFamily: theme.serif,
            fontSize: 17,
            lineHeight: 26.35,
            color: theme.ink,
          }}
        >
          {prompt}
        </Text>
      </View>

      {modelAnswer ? (
        <View style={{ marginTop: 14 }}>
          {revealed ? (
            <View
              style={{
                padding: 14,
                borderRadius: 14,
                backgroundColor: theme.accentSoft,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Inter_700Bold',
                  fontSize: 11,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                  color: theme.accent,
                  marginBottom: 6,
                }}
              >
                Model answer
              </Text>
              <Text
                style={{
                  fontFamily: theme.serif,
                  fontSize: 16,
                  lineHeight: 24.8,
                  color: theme.ink,
                }}
              >
                {modelAnswer}
              </Text>
            </View>
          ) : (
            <Pressable
              onPress={() => setRevealed(true)}
              style={{
                alignSelf: 'flex-start',
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: theme.pillBg,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  fontSize: 13,
                  color: theme.pillInk,
                }}
              >
                Reveal model answer
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

export interface OutlineBlocks {
  outline: Record<string, unknown>;
}

export function OutlineDigestRenderer({ outline }: OutlineBlocks) {
  const { theme } = useTheme();

  const renderNode = (node: unknown, depth: number): React.ReactNode => {
    if (typeof node === 'string') {
      return (
        <Text
          key={`${depth}-${node.slice(0, 24)}`}
          style={{
            fontFamily: 'Inter_400Regular',
            fontSize: 14,
            lineHeight: 22,
            color: theme.ink,
            paddingLeft: depth * 16,
          }}
        >
          {depth > 0 ? '• ' : ''}
          {node}
        </Text>
      );
    }
    if (Array.isArray(node)) {
      return node.map((item, idx) => (
        <View key={`${depth}-${idx}`}>{renderNode(item, depth)}</View>
      ));
    }
    if (node && typeof node === 'object') {
      return Object.entries(node as Record<string, unknown>).map(([key, value]) => (
        <View key={`${depth}-${key}`} style={{ marginBottom: 6 }}>
          <Text
            style={{
              fontFamily: theme.serif,
              fontSize: 16,
              letterSpacing: -0.2,
              color: theme.ink,
              paddingLeft: depth * 16,
              marginTop: depth === 0 ? 14 : 6,
            }}
          >
            {key}
          </Text>
          {renderNode(value, depth + 1)}
        </View>
      ));
    }
    return null;
  };

  return <View style={{ marginTop: 18 }}>{renderNode(outline, 0)}</View>;
}
