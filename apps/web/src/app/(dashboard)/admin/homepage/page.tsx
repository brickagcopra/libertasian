'use client';

import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';

import {
  useDeleteSiteContent,
  useSiteContent,
  useUpdateSiteContent,
} from '@/features/admin/hooks/use-site-content';
import {
  DEFAULT_HOMEPAGE_CONTENT,
  type HomepageContent,
} from '@/features/homepage/server/homepage-content';
import { ApiClientError } from '@/lib/api-client';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

// ---- Constants ----

const STUDY_PICKER_TONES = ['accent', 'cream', 'ink', 'accentSoft'] as const;
const STUDY_PICKER_GLYPHS = ['gavel', 'scales', 'book', 'hardhat'] as const;
const CONTRIBUTOR_TONES = ['sage', 'plum', 'warm', 'cool'] as const;
const PROGRESS_MAX_CELLS = 12;

// ---- Zod Schema (mirrors the warm-editorial HomepageContent shape) ----

const ctaSchema = z.object({
  text: z.string().min(1, 'Required'),
  href: z.string().min(1, 'Required'),
});

const labeledLinkSchema = z.object({
  label: z.string().min(1, 'Required'),
  href: z.string().min(1, 'Required'),
});

const heroWarmSchema = z.object({
  headlineTop: z.string().min(1),
  headlineBottom: z.string().min(1),
  speechBubble: z.string().min(1),
  body: z.string().min(1),
  primaryCta: ctaSchema.optional(),
  secondaryCta: ctaSchema.optional(),
});

const homepageSchema = z.object({
  hero: z.object({ warm: heroWarmSchema }),
  stats: z.object({
    items: z
      .array(z.object({ value: z.string().min(1), label: z.string().min(1) }))
      .min(1),
  }),
  studyPicker: z.object({
    sectionTitle: z.string().min(1),
    sectionLinkText: z.string().min(1),
    sectionLinkHref: z.string().min(1),
    items: z
      .array(
        z.object({
          label: z.string().min(1),
          count: z.string().min(1),
          tone: z.enum(STUDY_PICKER_TONES),
          glyph: z.enum(STUDY_PICKER_GLYPHS),
        }),
      )
      .min(1),
  }),
  featuresAccordion: z.object({
    eyebrow: z.string().min(1),
    sectionTitleLine1: z.string().min(1),
    sectionTitleLine2: z.string().min(1),
    sectionTitleLine3: z.string().min(1),
    items: z
      .array(
        z.object({
          number: z.string().min(1),
          label: z.string().min(1),
          detail: z.string().min(1),
          openByDefault: z.boolean().optional(),
        }),
      )
      .min(1),
    preview: z.object({
      eyebrow: z.string().min(1),
      headline: z.string().min(1),
      body: z.string().min(1),
      progress: z.array(z.number().int().min(0).max(1)),
      ctaText: z.string().min(1),
      badgeText: z.string().min(1),
    }),
  }),
  contributors: z.object({
    eyebrow: z.string().min(1),
    sectionTitleLine1: z.string().min(1),
    sectionTitleLine2: z.string().min(1),
    items: z
      .array(
        z.object({
          name: z.string().min(1),
          role: z.string().min(1),
          tone: z.enum(CONTRIBUTOR_TONES),
        }),
      )
      .min(1),
    ctaText: z.string().min(1),
    ctaHref: z.string().min(1),
  }),
  signupForm: z.object({
    headlineLine1: z.string().min(1),
    headlineAccent: z.string().min(1),
    body: z.string().min(1),
    nameLabel: z.string().min(1),
    emailLabel: z.string().min(1),
    stageLabel: z.string().min(1),
    stages: z.array(z.object({ value: z.string().min(1) })).min(1),
    subjectsLabel: z.string().min(1),
    subjects: z.array(z.object({ value: z.string().min(1) })).min(1),
    ctaText: z.string().min(1),
    ctaHref: z.string().min(1),
    finePrint: z.string(),
  }),
  disclaimer: z.string().min(1),
  footer: z.object({
    brandDescription: z.string().min(1),
    contactEmail: z.string().email(),
    tagline: z.string().optional(),
    productLinks: z.array(labeledLinkSchema),
    legalLinks: z.array(labeledLinkSchema),
    companyLinks: z.array(labeledLinkSchema).optional(),
  }),
});

type HomepageFormData = z.infer<typeof homepageSchema>;

// ---- Shape transforms (form <-> HomepageContent payload) ----

function toFormDefaults(): HomepageFormData {
  const d = DEFAULT_HOMEPAGE_CONTENT;
  // These keys are populated in DEFAULT_HOMEPAGE_CONTENT — the non-null assertion is intentional.
  const warm = d.hero.warm!;
  const stats = d.stats!;
  const studyPicker = d.studyPicker!;
  const featuresAccordion = d.featuresAccordion!;
  const contributors = d.contributors!;
  const signupForm = d.signupForm!;
  return {
    hero: { warm: { ...warm } },
    stats: { items: stats.items.map((item) => ({ ...item })) },
    studyPicker: {
      ...studyPicker,
      items: studyPicker.items.map((item) => ({ ...item })),
    },
    featuresAccordion: {
      ...featuresAccordion,
      items: featuresAccordion.items.map((item) => ({ ...item })),
      preview: {
        ...featuresAccordion.preview,
        progress: [...featuresAccordion.preview.progress],
      },
    },
    contributors: {
      ...contributors,
      items: contributors.items.map((item) => ({ ...item })),
    },
    signupForm: {
      ...signupForm,
      stages: signupForm.stages.map((value) => ({ value })),
      subjects: signupForm.subjects.map((value) => ({ value })),
    },
    disclaimer: d.disclaimer,
    footer: {
      brandDescription: d.footer.brandDescription,
      contactEmail: d.footer.contactEmail,
      tagline: d.footer.tagline ?? '',
      productLinks: d.footer.productLinks.map((link) => ({ ...link })),
      legalLinks: d.footer.legalLinks.map((link) => ({ ...link })),
      companyLinks: (d.footer.companyLinks ?? []).map((link) => ({ ...link })),
    },
  };
}

function fromContentToForm(content: Partial<HomepageContent> | undefined): HomepageFormData {
  const fallbacks = toFormDefaults();
  if (!content) return fallbacks;

  return {
    hero: { warm: content.hero?.warm ?? fallbacks.hero.warm },
    stats: content.stats ?? fallbacks.stats,
    studyPicker: content.studyPicker ?? fallbacks.studyPicker,
    featuresAccordion: content.featuresAccordion ?? fallbacks.featuresAccordion,
    contributors: content.contributors ?? fallbacks.contributors,
    signupForm: content.signupForm
      ? {
          ...content.signupForm,
          stages: content.signupForm.stages.map((value) => ({ value })),
          subjects: content.signupForm.subjects.map((value) => ({ value })),
        }
      : fallbacks.signupForm,
    disclaimer: content.disclaimer ?? fallbacks.disclaimer,
    footer: content.footer
      ? {
          brandDescription: content.footer.brandDescription,
          contactEmail: content.footer.contactEmail,
          tagline: content.footer.tagline ?? '',
          productLinks: content.footer.productLinks.map((link) => ({ ...link })),
          legalLinks: content.footer.legalLinks.map((link) => ({ ...link })),
          companyLinks: (content.footer.companyLinks ?? []).map((link) => ({ ...link })),
        }
      : fallbacks.footer,
  };
}

function fromFormToContent(data: HomepageFormData): Record<string, unknown> {
  return {
    hero: { warm: data.hero.warm },
    stats: data.stats,
    studyPicker: data.studyPicker,
    featuresAccordion: data.featuresAccordion,
    contributors: data.contributors,
    signupForm: {
      ...data.signupForm,
      stages: data.signupForm.stages.map((s) => s.value),
      subjects: data.signupForm.subjects.map((s) => s.value),
    },
    disclaimer: data.disclaimer,
    footer: {
      brandDescription: data.footer.brandDescription,
      contactEmail: data.footer.contactEmail,
      tagline: data.footer.tagline ?? '',
      productLinks: data.footer.productLinks,
      legalLinks: data.footer.legalLinks,
      companyLinks: data.footer.companyLinks ?? [],
    },
  };
}

// ---- Page Component ----

export default function AdminHomepagePage() {
  const { data: existing, isLoading, error: fetchError } = useSiteContent('homepage');
  const updateMutation = useUpdateSiteContent('homepage');
  const deleteMutation = useDeleteSiteContent('homepage');

  const [showResetDialog, setShowResetDialog] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const form = useForm<HomepageFormData>({
    resolver: zodResolver(homepageSchema),
    defaultValues: toFormDefaults(),
  });

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { isDirty },
  } = form;

  // Field arrays
  const statFields = useFieldArray({ control, name: 'stats.items' });
  const studyPickerFields = useFieldArray({ control, name: 'studyPicker.items' });
  const featureFields = useFieldArray({ control, name: 'featuresAccordion.items' });
  const contributorFields = useFieldArray({ control, name: 'contributors.items' });
  const stageFields = useFieldArray({ control, name: 'signupForm.stages' });
  const subjectFields = useFieldArray({ control, name: 'signupForm.subjects' });
  const productLinkFields = useFieldArray({ control, name: 'footer.productLinks' });
  const legalLinkFields = useFieldArray({ control, name: 'footer.legalLinks' });
  const companyLinkFields = useFieldArray({ control, name: 'footer.companyLinks' });

  // Hydrate form when server data arrives
  useEffect(() => {
    if (existing?.content) {
      reset(fromContentToForm(existing.content as Partial<HomepageContent>));
    }
  }, [existing, reset]);

  const onSubmit = async (data: HomepageFormData) => {
    try {
      await updateMutation.mutateAsync(fromFormToContent(data));
      setSuccessMsg('Homepage content saved successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch {
      // Error is rendered via updateMutation.error
    }
  };

  const handleReset = async () => {
    try {
      await deleteMutation.mutateAsync();
      reset(toFormDefaults());
      setShowResetDialog(false);
      setSuccessMsg('Homepage reset to defaults.');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch {
      // Error is rendered via deleteMutation.error
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Homepage Editor</h1>
          <p className="text-sm text-muted-foreground">
            Edit the public homepage content. Changes take effect within 5 minutes.
            {existing && (
              <span className="ml-2">
                Version {existing.version} &middot; Last updated{' '}
                {new Date(existing.updatedAt).toLocaleDateString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.open('/', '_blank')}>
            <ExternalLink className="mr-1.5 size-4" />
            Preview
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowResetDialog(true)}>
            <RotateCcw className="mr-1.5 size-4" />
            Reset to Defaults
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit(onSubmit)}
            disabled={updateMutation.isPending || !isDirty}
          >
            {updateMutation.isPending ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 size-4" />
            )}
            Save
          </Button>
        </div>
      </div>

      {/* Status Messages */}
      {successMsg && (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertDescription>{successMsg}</AlertDescription>
        </Alert>
      )}
      {updateMutation.error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>
            {updateMutation.error instanceof ApiClientError
              ? updateMutation.error.message
              : 'Failed to save. Please try again.'}
          </AlertDescription>
        </Alert>
      )}
      {fetchError &&
        !(fetchError instanceof ApiClientError && fetchError.statusCode === 404) && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>Failed to load existing content. Using defaults.</AlertDescription>
          </Alert>
        )}

      {/* Form */}
      <form id="homepage-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Accordion type="multiple" defaultValue={['hero']} className="space-y-4">
          {/* Hero */}
          <AccordionItem value="hero" className="rounded-lg border">
            <AccordionTrigger className="px-4 text-base font-semibold">Hero</AccordionTrigger>
            <AccordionContent className="space-y-4 px-4 pb-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="hero.warm.headlineTop">Headline (top line)</Label>
                  <Input id="hero.warm.headlineTop" {...register('hero.warm.headlineTop')} />
                </div>
                <div>
                  <Label htmlFor="hero.warm.headlineBottom">Headline (bottom line)</Label>
                  <Input id="hero.warm.headlineBottom" {...register('hero.warm.headlineBottom')} />
                </div>
              </div>
              <div>
                <Label htmlFor="hero.warm.speechBubble">Speech bubble</Label>
                <Textarea
                  id="hero.warm.speechBubble"
                  rows={2}
                  {...register('hero.warm.speechBubble')}
                />
              </div>
              <div>
                <Label htmlFor="hero.warm.body">Body</Label>
                <Textarea id="hero.warm.body" rows={3} {...register('hero.warm.body')} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Primary CTA text</Label>
                  <Input {...register('hero.warm.primaryCta.text')} />
                </div>
                <div>
                  <Label>Primary CTA link</Label>
                  <Input {...register('hero.warm.primaryCta.href')} />
                </div>
                <div>
                  <Label>Secondary CTA text</Label>
                  <Input {...register('hero.warm.secondaryCta.text')} />
                </div>
                <div>
                  <Label>Secondary CTA link</Label>
                  <Input {...register('hero.warm.secondaryCta.href')} />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Stats Strip */}
          <AccordionItem value="stats" className="rounded-lg border">
            <AccordionTrigger className="px-4 text-base font-semibold">
              Stats Strip ({statFields.fields.length})
            </AccordionTrigger>
            <AccordionContent className="space-y-3 px-4 pb-4">
              {statFields.fields.map((field, idx) => (
                <div key={field.id} className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label>Value</Label>
                    <Input {...register(`stats.items.${idx}.value`)} placeholder="90,000+" />
                  </div>
                  <div className="flex-1">
                    <Label>Label</Label>
                    <Input {...register(`stats.items.${idx}.label`)} placeholder="Cases targeted" />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => statFields.remove(idx)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => statFields.append({ value: '', label: '' })}
              >
                <Plus className="mr-1.5 size-4" /> Add stat
              </Button>
            </AccordionContent>
          </AccordionItem>

          {/* Study Picker */}
          <AccordionItem value="studyPicker" className="rounded-lg border">
            <AccordionTrigger className="px-4 text-base font-semibold">
              Study Picker ({studyPickerFields.fields.length})
            </AccordionTrigger>
            <AccordionContent className="space-y-4 px-4 pb-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label>Section title</Label>
                  <Input {...register('studyPicker.sectionTitle')} />
                </div>
                <div>
                  <Label>Section link text</Label>
                  <Input {...register('studyPicker.sectionLinkText')} />
                </div>
                <div>
                  <Label>Section link href</Label>
                  <Input {...register('studyPicker.sectionLinkHref')} />
                </div>
              </div>
              {studyPickerFields.fields.map((field, idx) => (
                <Card key={field.id}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Subject {idx + 1}</CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => studyPickerFields.remove(idx)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Label</Label>
                      <Input {...register(`studyPicker.items.${idx}.label`)} />
                    </div>
                    <div>
                      <Label>Count</Label>
                      <Input {...register(`studyPicker.items.${idx}.count`)} />
                    </div>
                    <div>
                      <Label>Tone</Label>
                      <Controller
                        control={control}
                        name={`studyPicker.items.${idx}.tone`}
                        render={({ field: f }) => (
                          <Select value={f.value} onValueChange={f.onChange}>
                            <SelectTrigger>
                              <SelectValue placeholder="Pick a tone" />
                            </SelectTrigger>
                            <SelectContent>
                              {STUDY_PICKER_TONES.map((tone) => (
                                <SelectItem key={tone} value={tone}>
                                  {tone}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                    <div>
                      <Label>Glyph</Label>
                      <Controller
                        control={control}
                        name={`studyPicker.items.${idx}.glyph`}
                        render={({ field: f }) => (
                          <Select value={f.value} onValueChange={f.onChange}>
                            <SelectTrigger>
                              <SelectValue placeholder="Pick a glyph" />
                            </SelectTrigger>
                            <SelectContent>
                              {STUDY_PICKER_GLYPHS.map((glyph) => (
                                <SelectItem key={glyph} value={glyph}>
                                  {glyph}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  studyPickerFields.append({
                    label: '',
                    count: '',
                    tone: 'accent',
                    glyph: 'gavel',
                  })
                }
              >
                <Plus className="mr-1.5 size-4" /> Add subject
              </Button>
            </AccordionContent>
          </AccordionItem>

          {/* Features Accordion */}
          <AccordionItem value="featuresAccordion" className="rounded-lg border">
            <AccordionTrigger className="px-4 text-base font-semibold">
              Features Accordion ({featureFields.fields.length})
            </AccordionTrigger>
            <AccordionContent className="space-y-4 px-4 pb-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Eyebrow</Label>
                  <Input {...register('featuresAccordion.eyebrow')} />
                </div>
                <div>
                  <Label>Section title (line 1)</Label>
                  <Input {...register('featuresAccordion.sectionTitleLine1')} />
                </div>
                <div>
                  <Label>Section title (line 2)</Label>
                  <Input {...register('featuresAccordion.sectionTitleLine2')} />
                </div>
                <div>
                  <Label>Section title (line 3)</Label>
                  <Input {...register('featuresAccordion.sectionTitleLine3')} />
                </div>
              </div>
              {featureFields.fields.map((field, idx) => (
                <Card key={field.id}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Feature {idx + 1}</CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => featureFields.remove(idx)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <Label>Number</Label>
                        <Input
                          {...register(`featuresAccordion.items.${idx}.number`)}
                          placeholder="01"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label>Label</Label>
                        <Input {...register(`featuresAccordion.items.${idx}.label`)} />
                      </div>
                    </div>
                    <div>
                      <Label>Detail</Label>
                      <Textarea rows={2} {...register(`featuresAccordion.items.${idx}.detail`)} />
                    </div>
                    <div className="flex items-center gap-2">
                      <Controller
                        control={control}
                        name={`featuresAccordion.items.${idx}.openByDefault`}
                        render={({ field: f }) => (
                          <Switch
                            checked={!!f.value}
                            onCheckedChange={(checked) => f.onChange(checked)}
                          />
                        )}
                      />
                      <Label className="text-sm font-normal">Open by default</Label>
                    </div>
                  </CardContent>
                </Card>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  featureFields.append({
                    number: '',
                    label: '',
                    detail: '',
                    openByDefault: false,
                  })
                }
              >
                <Plus className="mr-1.5 size-4" /> Add feature
              </Button>

              {/* Preview */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Preview panel</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Eyebrow</Label>
                      <Input {...register('featuresAccordion.preview.eyebrow')} />
                    </div>
                    <div>
                      <Label>Headline</Label>
                      <Input {...register('featuresAccordion.preview.headline')} />
                    </div>
                  </div>
                  <div>
                    <Label>Body</Label>
                    <Textarea rows={2} {...register('featuresAccordion.preview.body')} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>CTA text</Label>
                      <Input {...register('featuresAccordion.preview.ctaText')} />
                    </div>
                    <div>
                      <Label>Badge text</Label>
                      <Input {...register('featuresAccordion.preview.badgeText')} />
                    </div>
                  </div>
                  <ProgressEditor control={control} setValue={setValue} />
                </CardContent>
              </Card>
            </AccordionContent>
          </AccordionItem>

          {/* Contributors */}
          <AccordionItem value="contributors" className="rounded-lg border">
            <AccordionTrigger className="px-4 text-base font-semibold">
              Contributors ({contributorFields.fields.length})
            </AccordionTrigger>
            <AccordionContent className="space-y-4 px-4 pb-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label>Eyebrow</Label>
                  <Input {...register('contributors.eyebrow')} />
                </div>
                <div>
                  <Label>Section title (line 1)</Label>
                  <Input {...register('contributors.sectionTitleLine1')} />
                </div>
                <div>
                  <Label>Section title (line 2)</Label>
                  <Input {...register('contributors.sectionTitleLine2')} />
                </div>
              </div>
              {contributorFields.fields.map((field, idx) => (
                <Card key={field.id}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Contributor {idx + 1}</CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => contributorFields.remove(idx)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <Label>Name</Label>
                      <Input {...register(`contributors.items.${idx}.name`)} />
                    </div>
                    <div>
                      <Label>Role</Label>
                      <Input {...register(`contributors.items.${idx}.role`)} />
                    </div>
                    <div>
                      <Label>Tone</Label>
                      <Controller
                        control={control}
                        name={`contributors.items.${idx}.tone`}
                        render={({ field: f }) => (
                          <Select value={f.value} onValueChange={f.onChange}>
                            <SelectTrigger>
                              <SelectValue placeholder="Pick a tone" />
                            </SelectTrigger>
                            <SelectContent>
                              {CONTRIBUTOR_TONES.map((tone) => (
                                <SelectItem key={tone} value={tone}>
                                  {tone}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  contributorFields.append({ name: '', role: '', tone: 'sage' })
                }
              >
                <Plus className="mr-1.5 size-4" /> Add contributor
              </Button>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>CTA text</Label>
                  <Input {...register('contributors.ctaText')} />
                </div>
                <div>
                  <Label>CTA href</Label>
                  <Input {...register('contributors.ctaHref')} />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Signup Form */}
          <AccordionItem value="signupForm" className="rounded-lg border">
            <AccordionTrigger className="px-4 text-base font-semibold">Signup Form</AccordionTrigger>
            <AccordionContent className="space-y-4 px-4 pb-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Headline line 1</Label>
                  <Input {...register('signupForm.headlineLine1')} />
                </div>
                <div>
                  <Label>Headline accent</Label>
                  <Input {...register('signupForm.headlineAccent')} />
                </div>
              </div>
              <div>
                <Label>Body</Label>
                <Textarea rows={2} {...register('signupForm.body')} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Name label</Label>
                  <Input {...register('signupForm.nameLabel')} />
                </div>
                <div>
                  <Label>Email label</Label>
                  <Input {...register('signupForm.emailLabel')} />
                </div>
              </div>

              <div>
                <Label>Stage label</Label>
                <Input {...register('signupForm.stageLabel')} />
              </div>
              <div>
                <Label className="mb-2 block text-sm font-medium">Stages</Label>
                {stageFields.fields.map((field, idx) => (
                  <div key={field.id} className="mb-2 flex items-center gap-2">
                    <Input {...register(`signupForm.stages.${idx}.value`)} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => stageFields.remove(idx)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => stageFields.append({ value: '' })}
                >
                  <Plus className="mr-1.5 size-4" /> Add stage
                </Button>
              </div>

              <div>
                <Label>Subjects label</Label>
                <Input {...register('signupForm.subjectsLabel')} />
              </div>
              <div>
                <Label className="mb-2 block text-sm font-medium">Subjects</Label>
                {subjectFields.fields.map((field, idx) => (
                  <div key={field.id} className="mb-2 flex items-center gap-2">
                    <Input {...register(`signupForm.subjects.${idx}.value`)} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => subjectFields.remove(idx)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => subjectFields.append({ value: '' })}
                >
                  <Plus className="mr-1.5 size-4" /> Add subject
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>CTA text</Label>
                  <Input {...register('signupForm.ctaText')} />
                </div>
                <div>
                  <Label>CTA href</Label>
                  <Input {...register('signupForm.ctaHref')} />
                </div>
              </div>
              <div>
                <Label>Fine print</Label>
                <Input {...register('signupForm.finePrint')} />
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Disclaimer & Footer */}
          <AccordionItem value="disclaimerFooter" className="rounded-lg border">
            <AccordionTrigger className="px-4 text-base font-semibold">
              Disclaimer &amp; Footer
            </AccordionTrigger>
            <AccordionContent className="space-y-4 px-4 pb-4">
              <div>
                <Label>Legal disclaimer</Label>
                <Textarea rows={4} {...register('disclaimer')} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Brand description</Label>
                  <Input {...register('footer.brandDescription')} />
                </div>
                <div>
                  <Label>Contact email</Label>
                  <Input type="email" {...register('footer.contactEmail')} />
                </div>
              </div>

              <div>
                <Label>Footer tagline</Label>
                <Input {...register('footer.tagline')} />
              </div>

              <div>
                <Label className="mb-2 block text-sm font-medium">Product links</Label>
                {productLinkFields.fields.map((field, idx) => (
                  <div key={field.id} className="mb-2 flex items-center gap-2">
                    <Input
                      placeholder="Label"
                      {...register(`footer.productLinks.${idx}.label`)}
                    />
                    <Input
                      placeholder="URL"
                      {...register(`footer.productLinks.${idx}.href`)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => productLinkFields.remove(idx)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => productLinkFields.append({ label: '', href: '' })}
                >
                  <Plus className="mr-1.5 size-4" /> Add product link
                </Button>
              </div>

              <div>
                <Label className="mb-2 block text-sm font-medium">Legal links</Label>
                {legalLinkFields.fields.map((field, idx) => (
                  <div key={field.id} className="mb-2 flex items-center gap-2">
                    <Input
                      placeholder="Label"
                      {...register(`footer.legalLinks.${idx}.label`)}
                    />
                    <Input
                      placeholder="URL"
                      {...register(`footer.legalLinks.${idx}.href`)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => legalLinkFields.remove(idx)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => legalLinkFields.append({ label: '', href: '' })}
                >
                  <Plus className="mr-1.5 size-4" /> Add legal link
                </Button>
              </div>

              <div>
                <Label className="mb-2 block text-sm font-medium">Company links</Label>
                {companyLinkFields.fields.map((field, idx) => (
                  <div key={field.id} className="mb-2 flex items-center gap-2">
                    <Input
                      placeholder="Label"
                      {...register(`footer.companyLinks.${idx}.label`)}
                    />
                    <Input
                      placeholder="URL"
                      {...register(`footer.companyLinks.${idx}.href`)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => companyLinkFields.remove(idx)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => companyLinkFields.append({ label: '', href: '' })}
                >
                  <Plus className="mr-1.5 size-4" /> Add company link
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </form>

      {/* Reset confirmation */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all custom homepage content and restore the original defaults.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---- Progress (0/1) toggle editor ----

function ProgressEditor({
  control,
  setValue,
}: {
  control: ReturnType<typeof useForm<HomepageFormData>>['control'];
  setValue: ReturnType<typeof useForm<HomepageFormData>>['setValue'];
}) {
  const progress = useWatch({ control, name: 'featuresAccordion.preview.progress' }) ?? [];

  const toggleCell = (idx: number) => {
    const next = progress.map((cell, i) => (i === idx ? (cell === 1 ? 0 : 1) : cell));
    setValue('featuresAccordion.preview.progress', next, { shouldDirty: true });
  };

  const addCell = () => {
    if (progress.length >= PROGRESS_MAX_CELLS) return;
    setValue('featuresAccordion.preview.progress', [...progress, 0], { shouldDirty: true });
  };

  const removeLastCell = () => {
    if (progress.length === 0) return;
    setValue('featuresAccordion.preview.progress', progress.slice(0, -1), { shouldDirty: true });
  };

  return (
    <div>
      <Label className="mb-2 block text-sm font-medium">
        Progress bar ({progress.length} cells, max {PROGRESS_MAX_CELLS})
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        {progress.map((cell, idx) => (
          <button
            key={idx}
            type="button"
            aria-label={`Cell ${idx + 1}: ${cell === 1 ? 'on' : 'off'}`}
            onClick={() => toggleCell(idx)}
            className={`h-6 w-8 rounded border text-xs font-mono ${
              cell === 1
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground'
            }`}
          >
            {cell}
          </button>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addCell}
          disabled={progress.length >= PROGRESS_MAX_CELLS}
        >
          <Plus className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={removeLastCell}
          disabled={progress.length === 0}
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

