import { router } from 'expo-router';
import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';

import { apiClient } from '../../lib/api-client';
import { useAuth } from '../../providers/auth-provider';
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

export default function OnboardingScreen() {
  const { user, setUser } = useAuth();
  const [step, setStep] = useState(0);
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const progress = ((step + 1) / STEPS.length) * 100;
  const isStudentOrBarTaker = selectedRole === 'student' || selectedRole === 'bar_taker';

  function toggleChip(value: string, list: string[], setter: (v: string[]) => void) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function completeOnboarding(skipped: boolean) {
    setIsSubmitting(true);
    try {
      const res = await apiClient.patch<{
        success: boolean;
        data: AuthUser;
      }>('/users/me/onboarding', {
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
      if (res.data) {
        setUser(res.data);
      }
      router.replace('/(tabs)');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Progress */}
        <View style={styles.progressContainer}>
          <Text style={styles.stepText}>Step {step + 1} of {STEPS.length}</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
        </View>

        <View style={styles.card}>
          {/* Step 1: Welcome */}
          {step === 0 && (
            <View style={styles.centered}>
              <View style={styles.iconCircle}>
                <Text style={styles.iconText}>&#x2696;</Text>
              </View>
              <Text style={styles.heading}>
                Welcome{user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}!
              </Text>
              <Text style={styles.subheading}>
                Let&apos;s set up your LIBERTASIAN experience in under a minute.
              </Text>
              <View style={styles.bulletList}>
                {[
                  'AI-powered Philippine legal research',
                  'Auto-generated case digests with citations',
                  'Study mode with flashcards & bar reviewer',
                  'Scan documents to instant legal analysis',
                ].map((item) => (
                  <View key={item} style={styles.bulletRow}>
                    <Text style={styles.bulletCheck}>&#x2713;</Text>
                    <Text style={styles.bulletText}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Step 2: Role */}
          {step === 1 && (
            <View>
              <Text style={styles.heading}>What best describes you?</Text>
              <Text style={styles.subheadingLeft}>
                This helps us personalize your experience.
              </Text>
              {ROLES.map((role) => {
                const isSelected = selectedRole === role.value;
                return (
                  <TouchableOpacity
                    key={role.value}
                    style={[styles.roleCard, isSelected && styles.roleCardSelected]}
                    onPress={() => setSelectedRole(role.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.roleLabel, isSelected && styles.roleLabelSelected]}>
                      {role.label}
                    </Text>
                    <Text style={styles.roleDesc}>{role.description}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Step 3: Features */}
          {step === 2 && (
            <View>
              <Text style={styles.heading}>Here&apos;s what you can do</Text>
              <Text style={styles.subheadingLeft}>Key features tailored for your needs</Text>
              {getFeatures(selectedRole).map((f) => (
                <View key={f.title} style={styles.featureCard}>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureDesc}>{f.description}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Step 4: Preferences */}
          {step === 3 && (
            <View>
              <Text style={styles.heading}>
                {isStudentOrBarTaker ? 'Select your bar subjects' : 'Select your practice areas'}
              </Text>
              <Text style={styles.subheadingLeft}>
                Pick the ones most relevant to you.
              </Text>
              <View style={styles.chipContainer}>
                {(isStudentOrBarTaker ? BAR_SUBJECTS : PRACTICE_AREAS).map((item) => {
                  const list = isStudentOrBarTaker ? selectedSubjects : selectedAreas;
                  const setter = isStudentOrBarTaker ? setSelectedSubjects : setSelectedAreas;
                  const isSelected = list.includes(item);
                  return (
                    <TouchableOpacity
                      key={item}
                      style={[styles.chip, isSelected && styles.chipSelected]}
                      onPress={() => toggleChip(item, list, setter)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                        {item}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Step 5: Ready */}
          {step === 4 && (
            <View style={styles.centered}>
              <View style={[styles.iconCircle, { backgroundColor: '#dcfce7' }]}>
                <Text style={[styles.iconText, { color: '#16a34a' }]}>&#x2713;</Text>
              </View>
              <Text style={styles.heading}>You&apos;re all set!</Text>
              <Text style={styles.subheading}>
                Your personalized legal research experience is ready.
              </Text>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryLabel}>
                  Role: {ROLES.find((r) => r.value === selectedRole)?.label ?? 'Not set'}
                </Text>
                {isStudentOrBarTaker && selectedSubjects.length > 0 && (
                  <Text style={styles.summaryLabel}>
                    Subjects: {selectedSubjects.join(', ')}
                  </Text>
                )}
                {!isStudentOrBarTaker && selectedAreas.length > 0 && (
                  <Text style={styles.summaryLabel}>
                    Areas: {selectedAreas.join(', ')}
                  </Text>
                )}
              </View>
            </View>
          )}
        </View>

        {/* Navigation */}
        <View style={styles.navRow}>
          <View>
            {step > 0 && (
              <TouchableOpacity onPress={() => setStep(step - 1)} style={styles.backButton}>
                <Text style={styles.backButtonText}>Back</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.navRight}>
            {step < STEPS.length - 1 && (
              <TouchableOpacity
                onPress={() => completeOnboarding(true)}
                disabled={isSubmitting}
                style={styles.skipButton}
              >
                <Text style={styles.skipButtonText}>Skip</Text>
              </TouchableOpacity>
            )}
            {step < STEPS.length - 1 ? (
              <TouchableOpacity
                style={[styles.primaryButton, step === 1 && !selectedRole && styles.buttonDisabled]}
                onPress={() => setStep(step + 1)}
                disabled={step === 1 && !selectedRole}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryButtonText}>Continue</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.primaryButton, isSubmitting && styles.buttonDisabled]}
                onPress={() => completeOnboarding(false)}
                disabled={isSubmitting}
                activeOpacity={0.8}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>Start Exploring</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f5ff' },
  scrollContent: { flexGrow: 1, padding: 20, paddingTop: 40 },
  progressContainer: { marginBottom: 20 },
  stepText: { fontSize: 13, color: '#6b7280', marginBottom: 8 },
  progressBar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#1a56db', borderRadius: 3 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  centered: { alignItems: 'center' },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconText: { fontSize: 28, color: '#1a56db' },
  heading: { fontSize: 22, fontWeight: 'bold', color: '#111827', marginBottom: 8, textAlign: 'center' },
  subheading: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  subheadingLeft: { fontSize: 14, color: '#6b7280', marginBottom: 16, lineHeight: 20 },
  bulletList: { width: '100%', gap: 10, marginTop: 8 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bulletCheck: { fontSize: 16, color: '#16a34a', fontWeight: 'bold', marginTop: 1 },
  bulletText: { fontSize: 14, color: '#374151', flex: 1 },
  roleCard: {
    borderWidth: 2,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  roleCardSelected: { borderColor: '#1a56db', backgroundColor: '#eff6ff' },
  roleLabel: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 2 },
  roleLabelSelected: { color: '#1a56db' },
  roleDesc: { fontSize: 13, color: '#6b7280' },
  featureCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  featureTitle: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 4 },
  featureDesc: { fontSize: 13, color: '#6b7280', lineHeight: 18 },
  chipContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  chipSelected: { backgroundColor: '#1a56db', borderColor: '#1a56db' },
  chipText: { fontSize: 13, color: '#374151' },
  chipTextSelected: { color: '#fff', fontWeight: '600' },
  summaryBox: {
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    padding: 16,
    width: '100%',
    marginTop: 8,
    gap: 6,
  },
  summaryLabel: { fontSize: 14, color: '#374151' },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    paddingBottom: 20,
  },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backButton: { paddingVertical: 10, paddingHorizontal: 16 },
  backButtonText: { fontSize: 15, color: '#6b7280', fontWeight: '500' },
  skipButton: { paddingVertical: 10, paddingHorizontal: 12 },
  skipButtonText: { fontSize: 14, color: '#9ca3af' },
  primaryButton: {
    backgroundColor: '#1a56db',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    minWidth: 120,
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  buttonDisabled: { opacity: 0.5 },
});
