import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { topInsetPadding, bottomInsetPadding } from '@/lib/safe-area';
import { useTheme } from '@/providers/theme-provider';

export interface SignupSubject {
  id: string;
  label: string;
}

export interface SignupScreenProps {
  step?: number;
  totalSteps?: number;
  /** Eyebrow heading e.g. "Step 2 of 3". */
  stepLabel?: string;
  heading?: string;
  subheading?: string;
  subjects?: SignupSubject[];
  selectedSubjectIds?: string[];
  onToggleSubject?: (id: string) => void;
  barPrep?: boolean;
  onToggleBarPrep?: (next: boolean) => void;
  onBack?: () => void;
  onContinue?: () => void;
}

const DEFAULT_SUBJECTS: SignupSubject[] = [
  { id: 'con-law', label: 'Constitutional' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'torts', label: 'Torts' },
  { id: 'civpro', label: 'Civil Procedure' },
  { id: 'property', label: 'Property' },
  { id: 'crim', label: 'Criminal Law' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'tax', label: 'Tax' },
  { id: 'corp', label: 'Corporations' },
  { id: 'family', label: 'Family' },
  { id: 'ip', label: 'IP' },
  { id: 'bar', label: 'Bar Prep' },
];

export function SignupScreen({
  step = 2,
  totalSteps = 3,
  stepLabel,
  heading = 'What do you study?',
  subheading = "We'll tune your feed. Pick as many as you like.",
  subjects = DEFAULT_SUBJECTS,
  selectedSubjectIds = ['con-law', 'contracts', 'property', 'bar'],
  onToggleSubject,
  barPrep = true,
  onToggleBarPrep,
  onBack,
  onContinue,
}: SignupScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [internalSelected, setInternalSelected] = useState<string[]>(selectedSubjectIds);

  const selected = onToggleSubject ? selectedSubjectIds : internalSelected;
  const handleToggle = (id: string) => {
    if (onToggleSubject) {
      onToggleSubject(id);
    } else {
      setInternalSelected((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      );
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{
        paddingTop: topInsetPadding(insets, 64),
        paddingBottom: bottomInsetPadding(insets, 24),
        paddingHorizontal: 22,
        flexGrow: 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          onPress={onBack}
          accessibilityLabel="Go back"
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: theme.line,
            backgroundColor: theme.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="chevron-back" size={18} color={theme.ink} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <View
              key={i}
              style={{
                width: 24,
                height: 4,
                borderRadius: 2,
                backgroundColor: i < step ? theme.ink : theme.line,
              }}
            />
          ))}
        </View>
        <View style={{ width: 40 }} />
      </View>

      <View style={{ height: 30 }} />
      <Text
        style={{
          fontFamily: 'Inter_600SemiBold',
          fontSize: 12,
          color: theme.accent,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
        }}
      >
        {stepLabel ?? `Step ${step} of ${totalSteps}`}
      </Text>
      <Text
        style={{
          marginTop: 6,
          fontFamily: theme.serif,
          fontSize: 32,
          lineHeight: 33.6,
          letterSpacing: -1,
          color: theme.ink,
        }}
      >
        {heading}
      </Text>
      <Text
        style={{
          marginTop: 10,
          fontFamily: 'Inter_400Regular',
          fontSize: 14,
          color: theme.inkSoft,
        }}
      >
        {subheading}
      </Text>

      <View style={{ height: 22 }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {subjects.map((s) => (
          <Chip
            key={s.id}
            label={s.label}
            selected={selected.includes(s.id)}
            onPress={() => handleToggle(s.id)}
          />
        ))}
      </View>

      <View style={{ height: 22 }} />
      <View
        style={{
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.line,
          borderRadius: 16,
          padding: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            backgroundColor: theme.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="ribbon-outline" size={20} color={theme.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: theme.ink }}>
            I&apos;m prepping for the bar
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              fontSize: 12,
              color: theme.inkSoft,
              marginTop: 2,
            }}
          >
            Unlock MBE drills + outline packs
          </Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: barPrep }}
          onPress={() => onToggleBarPrep?.(!barPrep)}
          style={{
            width: 44,
            height: 26,
            borderRadius: 13,
            backgroundColor: barPrep ? theme.accent : theme.line,
            justifyContent: 'center',
            paddingHorizontal: 3,
          }}
        >
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: '#fff',
              alignSelf: barPrep ? 'flex-end' : 'flex-start',
            }}
          />
        </Pressable>
      </View>

      <View style={{ flex: 1 }} />
      <View style={{ marginTop: 24 }}>
        <Button label="Continue →" variant="primary" full onPress={onContinue} />
      </View>
    </ScrollView>
  );
}
