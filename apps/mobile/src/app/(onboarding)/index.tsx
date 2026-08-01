import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { topInsetPadding, bottomInsetPadding } from '@/lib/safe-area';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Logo } from '../../components/ui/Logo';
import { apiClient } from '../../lib/api-client';
import { useAuth } from '../../providers/auth-provider';
import { useTheme } from '../../providers/theme-provider';
import { mmkvStorage, STORAGE_KEYS } from '../../storage/mmkv';
import type { AuthUser } from '../../features/auth/types';

const STEPS = ['Welcome', 'Role', 'Features', 'Preferences', 'Ready'] as const;

const ROLES = [
  { value: 'student', label: 'Law Student', description: 'Study for exams and review cases' },
  { value: 'bar_taker', label: 'Bar Taker', description: 'Preparing for the Bar examinations' },
  { value: 'solo_practitioner', label: 'Solo Practitioner', description: 'Independent legal practice' },
  { value: 'firm_member', label: 'Firm Member', description: 'Part of a law firm or legal team' },
  { value: 'legal_editor', label: 'Legal Editor', description: 'Legal writing, editing, or research' },
] as const;

const BAR_SUBJECTS = [
  'Political Law', 'Labor Law', 'Civil Law', 'Taxation',
  'Commercial Law', 'Criminal Law', 'Remedial Law', 'Legal Ethics',
];

const PRACTICE_AREAS = [
  'Civil Litigation', 'Criminal Defense', 'Corporate Law', 'Family Law',
  'Immigration', 'Tax Law', 'Labor & Employment', 'Intellectual Property',
  'Real Estate', 'Environmental Law', 'Administrative Law', 'Election Law',
];

interface Feature {
  title: string;
  description: string;
}

function getFeatures(role: string): Feature[] {
  const common: Feature[] = [
    { title: 'AI Legal Search', description: 'Search Philippine case law with AI-powered results' },
    { title: 'Case Digests', description: 'Auto-generated digests with facts, issues, and rulings' },
  ];
  if (role === 'student' || role === 'bar_taker') {
    return [
      ...common,
      { title: 'Study Mode', description: 'Flashcards, reviewer packs, and bar syllabus study paths' },
      { title: 'Codal Reader', description: 'Browse codes and statutes with linked jurisprudence' },
    ];
  }
  return [
    ...common,
    { title: 'Scan to Digest', description: 'Photograph documents for instant AI case digests' },
    { title: 'Matter Workspace', description: 'Organize cases, notes, and tasks in workspaces' },
  ];
}

export default function OnboardingRoute() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, setUser } = useAuth();
  const [step, setStep] = useState(0);
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isStudentOrBarTaker = selectedRole === 'student' || selectedRole === 'bar_taker';
  const firstName = user?.fullName?.split(' ')[0] ?? '';

  function toggleChip(value: string, list: string[], setter: (v: string[]) => void) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function completeOnboarding(skipped: boolean) {
    setIsSubmitting(true);
    try {
      const updatedUser = await apiClient.patch<AuthUser>('/users/me/onboarding', {
        userRole: selectedRole || 'student',
        ...(isStudentOrBarTaker && selectedSubjects.length > 0 && {
          preferredBarSubjects: selectedSubjects,
        }),
        ...(!isStudentOrBarTaker && selectedAreas.length > 0 && {
          practiceAreas: selectedAreas,
        }),
        skipped,
      });
      mmkvStorage.setBoolean(STORAGE_KEYS.ONBOARDING_COMPLETED, true);
      if (updatedUser) setUser(updatedUser);
      router.replace('/(tabs)');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: topInsetPadding(insets, 64), paddingBottom: bottomInsetPadding(insets, 24), paddingHorizontal: 22, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Logo size={22} />
          <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 12, color: theme.inkSoft }}>
            Step {step + 1} of {STEPS.length}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 4, marginTop: 14 }}>
          {STEPS.map((_, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                backgroundColor: i <= step ? theme.ink : theme.line,
              }}
            />
          ))}
        </View>

        <View style={{ height: 30 }} />

        {step === 0 && (
          <>
            <Text
              style={{
                fontFamily: theme.serif,
                fontSize: 36,
                lineHeight: 37.8,
                letterSpacing: -1.2,
                color: theme.ink,
              }}
            >
              {firstName ? `Welcome, ${firstName}.` : 'Welcome.'}
            </Text>
            <Text
              style={{
                marginTop: 10,
                fontFamily: 'Inter_400Regular',
                fontSize: 15,
                lineHeight: 22.5,
                color: theme.inkSoft,
              }}
            >
              Let&apos;s set up your LIBERTASIAN experience in under a minute.
            </Text>
            <View style={{ height: 22 }} />
            <Card>
              <View style={{ gap: 14 }}>
                {[
                  'AI-powered Philippine legal research',
                  'Auto-generated case digests with citations',
                  'Study mode with flashcards & bar reviewer',
                  'Scan documents to instant legal analysis',
                ].map((item) => (
                  <View key={item} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        backgroundColor: theme.accent,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: 1,
                      }}
                    >
                      <Ionicons name="checkmark" size={14} color={theme.accentInk} />
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
                      {item}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          </>
        )}

        {step === 1 && (
          <>
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 12,
                color: theme.accent,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
              }}
            >
              About you
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
              What best describes you?
            </Text>
            <Text
              style={{
                marginTop: 10,
                fontFamily: 'Inter_400Regular',
                fontSize: 14,
                color: theme.inkSoft,
              }}
            >
              We&apos;ll personalize your experience.
            </Text>
            <View style={{ height: 22 }} />
            <View style={{ gap: 10 }}>
              {ROLES.map((role) => {
                const isSelected = selectedRole === role.value;
                return (
                  <Pressable
                    key={role.value}
                    onPress={() => setSelectedRole(role.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    style={{
                      backgroundColor: isSelected ? theme.accentSoft : theme.surface,
                      borderRadius: 14,
                      padding: 14,
                      borderWidth: 2,
                      borderColor: isSelected ? theme.accent : theme.line,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: theme.serif,
                        fontSize: 17,
                        letterSpacing: -0.2,
                        color: theme.ink,
                      }}
                    >
                      {role.label}
                    </Text>
                    <Text
                      style={{
                        marginTop: 2,
                        fontFamily: 'Inter_400Regular',
                        fontSize: 13,
                        color: theme.inkSoft,
                      }}
                    >
                      {role.description}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {step === 2 && (
          <>
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 12,
                color: theme.accent,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
              }}
            >
              What you&apos;ll get
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
              Here&apos;s what you can do.
            </Text>
            <View style={{ height: 22 }} />
            <View style={{ gap: 10 }}>
              {getFeatures(selectedRole).map((f) => (
                <Card key={f.title}>
                  <Text style={{ fontFamily: theme.serif, fontSize: 17, color: theme.ink, letterSpacing: -0.2 }}>
                    {f.title}
                  </Text>
                  <Text
                    style={{
                      marginTop: 4,
                      fontFamily: 'Inter_400Regular',
                      fontSize: 13,
                      lineHeight: 19,
                      color: theme.inkSoft,
                    }}
                  >
                    {f.description}
                  </Text>
                </Card>
              ))}
            </View>
          </>
        )}

        {step === 3 && (
          <>
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 12,
                color: theme.accent,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
              }}
            >
              {isStudentOrBarTaker ? 'Bar subjects' : 'Practice areas'}
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
              {isStudentOrBarTaker ? 'Pick your bar subjects.' : 'Pick your practice areas.'}
            </Text>
            <Text
              style={{
                marginTop: 10,
                fontFamily: 'Inter_400Regular',
                fontSize: 14,
                color: theme.inkSoft,
              }}
            >
              Choose as many as you like.
            </Text>
            <View style={{ height: 22 }} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(isStudentOrBarTaker ? BAR_SUBJECTS : PRACTICE_AREAS).map((item) => {
                const list = isStudentOrBarTaker ? selectedSubjects : selectedAreas;
                const setter = isStudentOrBarTaker ? setSelectedSubjects : setSelectedAreas;
                const isSelected = list.includes(item);
                return (
                  <Chip
                    key={item}
                    label={item}
                    selected={isSelected}
                    onPress={() => toggleChip(item, list, setter)}
                  />
                );
              })}
            </View>
          </>
        )}

        {step === 4 && (
          <>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: theme.accent,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 18,
              }}
            >
              <Ionicons name="checkmark" size={36} color={theme.accentInk} />
            </View>
            <Text
              style={{
                fontFamily: theme.serif,
                fontSize: 36,
                lineHeight: 37.8,
                letterSpacing: -1.2,
                color: theme.ink,
              }}
            >
              You&apos;re all set.
            </Text>
            <Text
              style={{
                marginTop: 10,
                fontFamily: 'Inter_400Regular',
                fontSize: 15,
                lineHeight: 22.5,
                color: theme.inkSoft,
              }}
            >
              Your personalized legal research experience is ready.
            </Text>
            <View style={{ height: 22 }} />
            <Card tone="muted" bordered={false}>
              <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: theme.ink }}>
                Role: {ROLES.find((r) => r.value === selectedRole)?.label ?? 'Not set'}
              </Text>
              {isStudentOrBarTaker && selectedSubjects.length > 0 ? (
                <Text style={{ marginTop: 6, fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft }}>
                  Subjects: {selectedSubjects.join(', ')}
                </Text>
              ) : null}
              {!isStudentOrBarTaker && selectedAreas.length > 0 ? (
                <Text style={{ marginTop: 6, fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft }}>
                  Areas: {selectedAreas.join(', ')}
                </Text>
              ) : null}
            </Card>
          </>
        )}

        <View style={{ flex: 1, minHeight: 24 }} />

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 24,
            gap: 12,
          }}
        >
          {step > 0 ? (
            <Pressable
              onPress={() => setStep(step - 1)}
              style={{ paddingVertical: 12, paddingHorizontal: 16 }}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 15, color: theme.inkSoft }}>
                Back
              </Text>
            </Pressable>
          ) : (
            <View />
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, justifyContent: 'flex-end' }}>
            {step < STEPS.length - 1 ? (
              <>
                <Pressable
                  onPress={() => completeOnboarding(true)}
                  disabled={isSubmitting}
                  style={{ paddingVertical: 12, paddingHorizontal: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel="Skip"
                >
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: theme.inkFaint }}>
                    Skip
                  </Text>
                </Pressable>
                <Button
                  label="Continue"
                  variant="primary"
                  disabled={step === 1 && !selectedRole}
                  onPress={() => setStep(step + 1)}
                />
              </>
            ) : (
              <Button
                label={isSubmitting ? 'Setting up…' : 'Start exploring'}
                variant="primary"
                disabled={isSubmitting}
                onPress={() => completeOnboarding(false)}
              />
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
