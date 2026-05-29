'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  BookOpen,
  Briefcase,
  Building,
  GraduationCap,
  Pencil,
  Search,
  Camera,
  Scale,
  FileText,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { apiClient } from '@/lib/api-client';
import { ROUTES } from '@/lib/constants';
import { useAuthStore } from '@/stores/auth-store';

const STEPS = ['Welcome', 'Role', 'Features', 'Preferences', 'Ready'] as const;

const ROLES = [
  {
    value: 'student',
    label: 'Law Student',
    description: 'Study for exams and review cases',
    icon: GraduationCap,
  },
  {
    value: 'bar_taker',
    label: 'Bar Taker',
    description: 'Preparing for the Bar examinations',
    icon: BookOpen,
  },
  {
    value: 'solo_practitioner',
    label: 'Solo Practitioner',
    description: 'Independent legal practice',
    icon: Briefcase,
  },
  {
    value: 'firm_member',
    label: 'Firm Member',
    description: 'Part of a law firm or legal team',
    icon: Building,
  },
  {
    value: 'legal_editor',
    label: 'Legal Editor/Researcher',
    description: 'Legal writing, editing, or academic research',
    icon: Pencil,
  },
] as const;

const BAR_SUBJECTS = [
  'Political Law',
  'Labor Law',
  'Civil Law',
  'Taxation',
  'Mercantile Law',
  'Criminal Law',
  'Remedial Law',
  'Legal Ethics',
];

const PRACTICE_AREAS = [
  'Civil Litigation',
  'Criminal Defense',
  'Corporate Law',
  'Family Law',
  'Immigration',
  'Tax Law',
  'Labor & Employment',
  'Intellectual Property',
  'Real Estate',
  'Environmental Law',
  'Administrative Law',
  'Election Law',
];

function getFeatures(role: string) {
  const common = [
    { icon: Search, title: 'AI Legal Search', description: 'Search Philippine case law, statutes, and regulations with AI-powered results' },
    { icon: FileText, title: 'Case Digests', description: 'Auto-generated case digests with facts, issues, rulings, and doctrine extraction' },
  ];

  if (role === 'student' || role === 'bar_taker') {
    return [
      ...common,
      { icon: BookOpen, title: 'Study Mode', description: 'Flashcards, reviewer packs, and syllabus-based study paths for bar subjects' },
      { icon: Scale, title: 'Codal Reader', description: 'Browse Philippine codes and statutes with linked jurisprudence' },
    ];
  }

  return [
    ...common,
    { icon: Camera, title: 'Scan to Digest', description: 'Photograph legal documents and get instant AI-powered case digests' },
    { icon: Briefcase, title: 'Matter Workspace', description: 'Organize cases, notes, tasks, and research in dedicated workspaces' },
  ];
}

export default function OnboardingPage() {
  const router = useRouter();
  const { user, setUser } = useAuthStore();
  const [step, setStep] = useState(0);
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const progress = ((step + 1) / STEPS.length) * 100;
  const isStudentOrBarTaker = selectedRole === 'student' || selectedRole === 'bar_taker';

  async function completeOnboarding(skipped: boolean) {
    setIsSubmitting(true);
    try {
      const res = await apiClient.patch<{
        success: boolean;
        data: { onboardingCompletedAt: string; userRole: string };
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
      if (user) {
        setUser({
          ...user,
          onboardingCompletedAt: res.data.onboardingCompletedAt,
          userRole: res.data.userRole,
        });
      }
      router.push(ROUTES.SEARCH);
    } finally {
      setIsSubmitting(false);
    }
  }

  function toggleChip(value: string, list: string[], setter: (v: string[]) => void) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-white p-4">
      <div className="w-full max-w-2xl">
        {/* Progress */}
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between text-sm text-gray-500">
            <span>Step {step + 1} of {STEPS.length}</span>
            <span>{STEPS[step]}</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <Card className="shadow-lg">
          <CardContent className="p-8">
            {/* Step 1: Welcome */}
            {step === 0 && (
              <div className="text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100">
                  <Scale className="h-8 w-8 text-blue-600" />
                </div>
                <h1 className="mb-2 text-2xl font-bold text-gray-900">
                  Welcome{user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}!
                </h1>
                <p className="mb-8 text-gray-600">
                  Let&apos;s set up your LIBERTASIAN experience in under a minute.
                </p>
                <div className="mx-auto max-w-md space-y-3 text-left">
                  {[
                    'AI-powered Philippine legal research',
                    'Auto-generated case digests with citations',
                    'Study mode with flashcards & bar reviewer',
                    'Scan documents to instant legal analysis',
                  ].map((item) => (
                    <div key={item} className="flex items-start gap-3">
                      <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
                      <span className="text-sm text-gray-700">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2: Role Selection */}
            {step === 1 && (
              <div>
                <h2 className="mb-2 text-xl font-bold text-gray-900">What best describes you?</h2>
                <p className="mb-6 text-sm text-gray-500">
                  This helps us personalize your experience. You can change this later.
                </p>
                <div className="grid gap-3">
                  {ROLES.map((role) => {
                    const Icon = role.icon;
                    const isSelected = selectedRole === role.value;
                    return (
                      <button
                        key={role.value}
                        type="button"
                        onClick={() => setSelectedRole(role.value)}
                        className={`flex items-center gap-4 rounded-lg border-2 p-4 text-left transition-all ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                          isSelected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'
                        }`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{role.label}</div>
                          <div className="text-sm text-gray-500">{role.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 3: Feature Highlights */}
            {step === 2 && (
              <div>
                <h2 className="mb-2 text-xl font-bold text-gray-900">Here&apos;s what you can do</h2>
                <p className="mb-6 text-sm text-gray-500">
                  Key features tailored for your needs
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {getFeatures(selectedRole).map((feature) => {
                    const Icon = feature.icon;
                    return (
                      <div key={feature.title} className="rounded-lg border border-gray-200 p-4">
                        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                          <Icon className="h-5 w-5 text-blue-600" />
                        </div>
                        <h3 className="mb-1 font-medium text-gray-900">{feature.title}</h3>
                        <p className="text-sm text-gray-500">{feature.description}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 4: Preferences */}
            {step === 3 && (
              <div>
                <h2 className="mb-2 text-xl font-bold text-gray-900">
                  {isStudentOrBarTaker ? 'Select your bar subjects' : 'Select your practice areas'}
                </h2>
                <p className="mb-6 text-sm text-gray-500">
                  Pick the ones most relevant to you. You can always update these later.
                </p>
                <div className="flex flex-wrap gap-2">
                  {(isStudentOrBarTaker ? BAR_SUBJECTS : PRACTICE_AREAS).map((item) => {
                    const list = isStudentOrBarTaker ? selectedSubjects : selectedAreas;
                    const setter = isStudentOrBarTaker ? setSelectedSubjects : setSelectedAreas;
                    const isSelected = list.includes(item);
                    return (
                      <Badge
                        key={item}
                        variant={isSelected ? 'default' : 'outline'}
                        className={`cursor-pointer px-3 py-1.5 text-sm transition-all ${
                          isSelected ? '' : 'hover:bg-gray-100'
                        }`}
                        onClick={() => toggleChip(item, list, setter)}
                      >
                        {item}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 5: Ready */}
            {step === 4 && (
              <div className="text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
                <h2 className="mb-2 text-2xl font-bold text-gray-900">You&apos;re all set!</h2>
                <p className="mb-6 text-gray-600">
                  Your personalized legal research experience is ready.
                </p>
                <div className="mx-auto mb-8 max-w-sm space-y-2 text-left">
                  <div className="flex items-center gap-3 text-sm text-gray-700">
                    <span className="font-medium">Role:</span>
                    <span>{ROLES.find((r) => r.value === selectedRole)?.label ?? 'Not set'}</span>
                  </div>
                  {isStudentOrBarTaker && selectedSubjects.length > 0 && (
                    <div className="flex items-start gap-3 text-sm text-gray-700">
                      <span className="font-medium shrink-0">Subjects:</span>
                      <span>{selectedSubjects.join(', ')}</span>
                    </div>
                  )}
                  {!isStudentOrBarTaker && selectedAreas.length > 0 && (
                    <div className="flex items-start gap-3 text-sm text-gray-700">
                      <span className="font-medium shrink-0">Areas:</span>
                      <span>{selectedAreas.join(', ')}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="mt-8 flex items-center justify-between">
              <div>
                {step > 0 && (
                  <Button variant="ghost" onClick={() => setStep(step - 1)}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-3">
                {step < STEPS.length - 1 && (
                  <Button
                    variant="ghost"
                    className="text-gray-500"
                    onClick={() => completeOnboarding(true)}
                    disabled={isSubmitting}
                  >
                    Skip
                  </Button>
                )}
                {step < STEPS.length - 1 ? (
                  <Button
                    onClick={() => setStep(step + 1)}
                    disabled={step === 1 && !selectedRole}
                  >
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={() => completeOnboarding(false)}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Setting up...' : 'Start Exploring'}
                    {!isSubmitting && <ArrowRight className="ml-2 h-4 w-4" />}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
