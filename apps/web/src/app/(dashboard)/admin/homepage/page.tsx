'use client';

import { useState, useEffect } from 'react';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Save,
  RotateCcw,
  ExternalLink,
  Plus,
  Trash2,
  ChevronDown,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

import {
  useSiteContent,
  useUpdateSiteContent,
  useDeleteSiteContent,
} from '@/features/admin/hooks/use-site-content';
import { ApiClientError } from '@/lib/api-client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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

// ---- Zod Schema ----

const ctaSchema = z.object({
  text: z.string().min(1, 'Required'),
  href: z.string().min(1, 'Required'),
});

const homepageSchema = z.object({
  hero: z.object({
    tagline: z.string().min(1),
    headline: z.string().min(1),
    headlineAccent: z.string().min(1),
    description: z.string().min(1),
    primaryCta: ctaSchema,
    secondaryCta: ctaSchema,
    finePrint: z.string(),
  }),
  features: z.object({
    sectionTitle: z.string().min(1),
    sectionSubtitle: z.string().min(1),
    items: z.array(z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      icon: z.string().min(1),
    })).min(1),
  }),
  differentiators: z.object({
    sectionTitle: z.string().min(1),
    sectionSubtitle: z.string().min(1),
    items: z.array(z.object({
      capability: z.string().min(1),
      libertasian: z.boolean(),
      others: z.string(),
      note: z.string(),
    })).min(1),
  }),
  trust: z.object({
    sectionTitle: z.string().min(1),
    sectionSubtitle: z.string().min(1),
    items: z.array(z.object({
      title: z.string().min(1),
      description: z.string().min(1),
    })).min(1),
  }),
  personas: z.object({
    sectionTitle: z.string().min(1),
    sectionSubtitle: z.string().min(1),
    items: z.array(z.object({
      title: z.string().min(1),
      plan: z.string().min(1),
      price: z.string().min(1),
      features: z.array(z.string().min(1)).min(1),
    })).min(1),
  }),
  cta: z.object({
    headline: z.string().min(1),
    description: z.string().min(1),
    primaryCta: ctaSchema,
    secondaryCta: ctaSchema,
  }),
  disclaimer: z.string().min(1),
  footer: z.object({
    brandDescription: z.string().min(1),
    contactEmail: z.string().email(),
    productLinks: z.array(z.object({
      label: z.string().min(1),
      href: z.string().min(1),
    })),
    legalLinks: z.array(z.object({
      label: z.string().min(1),
      href: z.string().min(1),
    })),
  }),
});

type HomepageFormData = z.infer<typeof homepageSchema>;

// ---- Default values (same as page.tsx defaults) ----

const DEFAULTS: HomepageFormData = {
  hero: {
    tagline: 'Philippine Legal AI Platform',
    headline: 'Legal research,',
    headlineAccent: 'reimagined.',
    description:
      'AI-powered search, case digest generation, camera scan-to-digest, bar review tools, and a full practice workspace. Built exclusively for Philippine law. Grounded in authoritative sources. Private by default.',
    primaryCta: { text: 'Get Started Free', href: '/auth/callback?mode=register' },
    secondaryCta: { text: 'View Plans', href: '/pricing' },
    finePrint: 'Free plan includes corpus access, 15 AI credits, and basic search. No credit card required.',
  },
  features: {
    sectionTitle: 'Everything you need for Philippine legal work',
    sectionSubtitle: 'From first-year law student to senior partner. One platform, every tool.',
    items: [
      { title: 'AI Legal Research', description: 'Get AI-powered answers to legal questions with full source citations. Hybrid BM25 + semantic retrieval from 90,000+ Philippine legal documents.', icon: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z' },
      { title: 'Case Digest Generation', description: 'Generate structured DFIR+ digests automatically — summary, facts, arguments, issues, ruling, doctrine, and dispositive with provenance mapping.', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z' },
      { title: 'Camera Scan to Digest', description: 'Scan printed legal documents with your phone. On-device edge detection, deskew, and enhancement. Server-side OCR generates searchable, citable digests.', icon: 'M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z M15 12.75a3 3 0 11-6 0 3 3 0 016 0z' },
      { title: 'Study & Bar Review', description: 'Codal reader organized by bar subject, AI-generated flashcards with spaced repetition, reviewer packs, syllabus mode, and offline mobile reading.', icon: 'M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5' },
      { title: 'Practice Workspace', description: 'Manage matters, draft legal memos, compare cases, generate pleadings, and collaborate with your team. Tasks, calendar, audit logs, and role-based access.', icon: 'M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0' },
      { title: 'Editorial Corpus', description: 'Sourced from the Supreme Court E-Library, Lawphil, and Official Gazette. Automated ingestion, truthfulness validation, and editorial review queue.', icon: 'M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z' },
    ],
  },
  differentiators: {
    sectionTitle: 'Why LIBERTASIAN?',
    sectionSubtitle: 'No single competitor combines all these capabilities. We do.',
    items: [
      { capability: 'AI legal research & answers', libertasian: true, others: 'Partial', note: 'Only LIBERTASIAN combines all features in one platform' },
      { capability: 'Camera scan to digest', libertasian: true, others: 'None', note: 'No competitor offers mobile camera scan-to-digest' },
      { capability: 'Codal reader (by bar subject)', libertasian: true, others: 'eCodal+ only', note: 'Combined with AI search and flashcards' },
      { capability: 'Practice workspace (matters, tasks)', libertasian: true, others: 'None', note: 'No competitor offers matter management' },
      { capability: 'Flashcards & spaced repetition', libertasian: true, others: 'None', note: 'Auto-generated from digests with SM-2 algorithm' },
      { capability: 'Offline mobile reading', libertasian: true, others: 'eCodal+ only', note: 'Full codal + digest offline cache' },
      { capability: 'Team collaboration', libertasian: true, others: 'JurisChat V2', note: 'With audit logs, RBAC, and client-safe sharing' },
      { capability: 'Transparent truthfulness controls', libertasian: true, others: 'Internal only', note: 'Public confidence thresholds and review workflows' },
    ],
  },
  trust: {
    sectionTitle: 'Built on trust and truthfulness',
    sectionSubtitle: 'Legal AI demands accuracy. We take that seriously.',
    items: [
      { title: 'Zero Fabricated Citations', description: 'Every AI-generated claim links to a verifiable source passage. If support is insufficient, the system abstains rather than hallucinate.' },
      { title: 'Official Sources First', description: 'Authoritative government publications take precedence. Supreme Court E-Library, Lawphil, and Official Gazette are primary sources.' },
      { title: 'Private by Default', description: 'Your camera scans, uploads, and notes never enter the public corpus without explicit permission and editorial rights review.' },
      { title: 'Full Provenance', description: 'Every digest, summary, and AI output traces back to specific source sections. Source Excerpt, Grounded Summary, and Inferred Analysis are clearly labeled.' },
    ],
  },
  personas: {
    sectionTitle: 'For every legal professional',
    sectionSubtitle: 'Purpose-built for the Philippine legal ecosystem.',
    items: [
      { title: 'Bar Examinees & Students', plan: 'Edu', price: '499', features: ['Codal reader by bar subject', 'AI flashcards with spaced repetition', 'Reviewer packs & syllabus mode', 'Offline mobile reading', 'Study progress tracking'] },
      { title: 'Solo Practitioners', plan: 'Pro', price: '999', features: ['Unlimited AI answers & digests', 'Camera scan-to-digest', 'Memo drafting assistance', 'Case comparison & analysis', 'Matter folders (20 active)'] },
      { title: 'Small Firms', plan: 'Team', price: '799/seat', features: ['Team workspace & collaboration', 'Shared digests & knowledge base', 'Task management & calendar', 'Role-based access control', 'Audit logs & client-safe sharing'] },
      { title: 'Enterprise & Editorial', plan: 'Enterprise', price: 'Custom', features: ['Official source ingestion tools', 'Editorial review queue', 'Publish to shared corpus', 'Corpus health monitoring', 'API access & custom integrations'] },
    ],
  },
  cta: {
    headline: 'Start your legal research today',
    description: 'Join thousands of Filipino legal professionals using AI-powered research. Free plan available. No credit card required.',
    primaryCta: { text: 'Create Free Account', href: '/auth/callback?mode=register' },
    secondaryCta: { text: 'Compare Plans', href: '/pricing' },
  },
  disclaimer: 'LIBERTASIAN provides AI-powered legal research tools for informational purposes only. AI outputs are not legal advice and do not create an attorney-client relationship. Always consult a qualified Philippine lawyer for legal matters. The practice of law in the Philippines is reserved for members of the Philippine Bar.',
  footer: {
    brandDescription: 'Philippine Legal AI Platform. Democratizing access to legal knowledge.',
    contactEmail: 'support@libertasian.com',
    productLinks: [
      { label: 'Features', href: '#features' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Get Started', href: '/auth/callback?mode=register' },
    ],
    legalLinks: [
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Privacy Policy', href: '/privacy' },
    ],
  },
};

// ---- Page Component ----

export default function AdminHomepagePage() {
  const { data: existing, isLoading, error: fetchError } = useSiteContent('homepage');
  const updateMutation = useUpdateSiteContent('homepage');
  const deleteMutation = useDeleteSiteContent('homepage');
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const form = useForm<HomepageFormData>({
    resolver: zodResolver(homepageSchema),
    defaultValues: DEFAULTS,
  });

  const { control, register, handleSubmit, reset, setValue, formState: { errors, isDirty } } = form;

  // Feature items field array
  const featureFields = useFieldArray({ control, name: 'features.items' });
  const diffFields = useFieldArray({ control, name: 'differentiators.items' });
  const trustFields = useFieldArray({ control, name: 'trust.items' });
  const personaFields = useFieldArray({ control, name: 'personas.items' });
  const productLinkFields = useFieldArray({ control, name: 'footer.productLinks' });
  const legalLinkFields = useFieldArray({ control, name: 'footer.legalLinks' });

  // Load existing data into form
  useEffect(() => {
    if (existing?.content) {
      reset(existing.content as HomepageFormData);
    }
  }, [existing, reset]);

  const onSubmit = async (data: HomepageFormData) => {
    try {
      await updateMutation.mutateAsync(data as unknown as Record<string, unknown>);
      setSuccessMsg('Homepage content saved successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch {
      // Error is available via updateMutation.error
    }
  };

  const handleReset = async () => {
    try {
      await deleteMutation.mutateAsync();
      reset(DEFAULTS);
      setShowResetDialog(false);
      setSuccessMsg('Homepage reset to defaults.');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch {
      // Error is available via deleteMutation.error
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open('/', '_blank')}
          >
            <ExternalLink className="mr-1.5 size-4" />
            Preview
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowResetDialog(true)}
          >
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
      {fetchError && !(fetchError instanceof ApiClientError && fetchError.statusCode === 404) && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>Failed to load existing content. Using defaults.</AlertDescription>
        </Alert>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Accordion type="multiple" defaultValue={['hero']} className="space-y-4">

          {/* Hero Section */}
          <AccordionItem value="hero" className="rounded-lg border">
            <AccordionTrigger className="px-4 text-base font-semibold">Hero Section</AccordionTrigger>
            <AccordionContent className="space-y-4 px-4 pb-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="hero.tagline">Tagline</Label>
                  <Input id="hero.tagline" {...register('hero.tagline')} />
                </div>
                <div>
                  <Label htmlFor="hero.headline">Headline</Label>
                  <Input id="hero.headline" {...register('hero.headline')} />
                </div>
                <div>
                  <Label htmlFor="hero.headlineAccent">Headline Accent</Label>
                  <Input id="hero.headlineAccent" {...register('hero.headlineAccent')} />
                </div>
                <div>
                  <Label htmlFor="hero.finePrint">Fine Print</Label>
                  <Input id="hero.finePrint" {...register('hero.finePrint')} />
                </div>
              </div>
              <div>
                <Label htmlFor="hero.description">Description</Label>
                <Textarea id="hero.description" rows={3} {...register('hero.description')} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Primary CTA Text</Label>
                  <Input {...register('hero.primaryCta.text')} />
                </div>
                <div>
                  <Label>Primary CTA Link</Label>
                  <Input {...register('hero.primaryCta.href')} />
                </div>
                <div>
                  <Label>Secondary CTA Text</Label>
                  <Input {...register('hero.secondaryCta.text')} />
                </div>
                <div>
                  <Label>Secondary CTA Link</Label>
                  <Input {...register('hero.secondaryCta.href')} />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Features Section */}
          <AccordionItem value="features" className="rounded-lg border">
            <AccordionTrigger className="px-4 text-base font-semibold">Features ({featureFields.fields.length})</AccordionTrigger>
            <AccordionContent className="space-y-4 px-4 pb-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Section Title</Label>
                  <Input {...register('features.sectionTitle')} />
                </div>
                <div>
                  <Label>Section Subtitle</Label>
                  <Input {...register('features.sectionSubtitle')} />
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
                    <div>
                      <Label>Title</Label>
                      <Input {...register(`features.items.${idx}.title`)} />
                    </div>
                    <div>
                      <Label>Description</Label>
                      <Textarea rows={2} {...register(`features.items.${idx}.description`)} />
                    </div>
                    <div>
                      <Label>Icon SVG Path</Label>
                      <Input {...register(`features.items.${idx}.icon`)} className="font-mono text-xs" />
                    </div>
                  </CardContent>
                </Card>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => featureFields.append({ title: '', description: '', icon: '' })}
              >
                <Plus className="mr-1.5 size-4" /> Add Feature
              </Button>
            </AccordionContent>
          </AccordionItem>

          {/* Differentiators Section */}
          <AccordionItem value="differentiators" className="rounded-lg border">
            <AccordionTrigger className="px-4 text-base font-semibold">Differentiators ({diffFields.fields.length})</AccordionTrigger>
            <AccordionContent className="space-y-4 px-4 pb-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Section Title</Label>
                  <Input {...register('differentiators.sectionTitle')} />
                </div>
                <div>
                  <Label>Section Subtitle</Label>
                  <Input {...register('differentiators.sectionSubtitle')} />
                </div>
              </div>
              {diffFields.fields.map((field, idx) => (
                <Card key={field.id}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Row {idx + 1}</CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => diffFields.remove(idx)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Capability</Label>
                      <Input {...register(`differentiators.items.${idx}.capability`)} />
                    </div>
                    <div>
                      <Label>Others</Label>
                      <Input {...register(`differentiators.items.${idx}.others`)} />
                    </div>
                    <div className="sm:col-span-2">
                      <Label>Note</Label>
                      <Input {...register(`differentiators.items.${idx}.note`)} />
                    </div>
                  </CardContent>
                </Card>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => diffFields.append({ capability: '', libertasian: true, others: '', note: '' })}
              >
                <Plus className="mr-1.5 size-4" /> Add Row
              </Button>
            </AccordionContent>
          </AccordionItem>

          {/* Trust Section */}
          <AccordionItem value="trust" className="rounded-lg border">
            <AccordionTrigger className="px-4 text-base font-semibold">Trust & Safety ({trustFields.fields.length})</AccordionTrigger>
            <AccordionContent className="space-y-4 px-4 pb-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Section Title</Label>
                  <Input {...register('trust.sectionTitle')} />
                </div>
                <div>
                  <Label>Section Subtitle</Label>
                  <Input {...register('trust.sectionSubtitle')} />
                </div>
              </div>
              {trustFields.fields.map((field, idx) => (
                <Card key={field.id}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Item {idx + 1}</CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => trustFields.remove(idx)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <Label>Title</Label>
                      <Input {...register(`trust.items.${idx}.title`)} />
                    </div>
                    <div>
                      <Label>Description</Label>
                      <Textarea rows={2} {...register(`trust.items.${idx}.description`)} />
                    </div>
                  </CardContent>
                </Card>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => trustFields.append({ title: '', description: '' })}
              >
                <Plus className="mr-1.5 size-4" /> Add Item
              </Button>
            </AccordionContent>
          </AccordionItem>

          {/* Personas Section */}
          <AccordionItem value="personas" className="rounded-lg border">
            <AccordionTrigger className="px-4 text-base font-semibold">Personas / Pricing Cards ({personaFields.fields.length})</AccordionTrigger>
            <AccordionContent className="space-y-4 px-4 pb-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Section Title</Label>
                  <Input {...register('personas.sectionTitle')} />
                </div>
                <div>
                  <Label>Section Subtitle</Label>
                  <Input {...register('personas.sectionSubtitle')} />
                </div>
              </div>
              {personaFields.fields.map((field, idx) => (
                <PersonaEditor
                  key={field.id}
                  index={idx}
                  register={register}
                  control={control}
                  setValue={setValue}
                  onRemove={() => personaFields.remove(idx)}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => personaFields.append({ title: '', plan: '', price: '', features: [''] })}
              >
                <Plus className="mr-1.5 size-4" /> Add Persona Card
              </Button>
            </AccordionContent>
          </AccordionItem>

          {/* CTA Section */}
          <AccordionItem value="cta" className="rounded-lg border">
            <AccordionTrigger className="px-4 text-base font-semibold">Call to Action</AccordionTrigger>
            <AccordionContent className="space-y-4 px-4 pb-4">
              <div>
                <Label>Headline</Label>
                <Input {...register('cta.headline')} />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea rows={2} {...register('cta.description')} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Primary CTA Text</Label>
                  <Input {...register('cta.primaryCta.text')} />
                </div>
                <div>
                  <Label>Primary CTA Link</Label>
                  <Input {...register('cta.primaryCta.href')} />
                </div>
                <div>
                  <Label>Secondary CTA Text</Label>
                  <Input {...register('cta.secondaryCta.text')} />
                </div>
                <div>
                  <Label>Secondary CTA Link</Label>
                  <Input {...register('cta.secondaryCta.href')} />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Disclaimer */}
          <AccordionItem value="disclaimer" className="rounded-lg border">
            <AccordionTrigger className="px-4 text-base font-semibold">Legal Disclaimer</AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <Textarea rows={4} {...register('disclaimer')} />
            </AccordionContent>
          </AccordionItem>

          {/* Footer */}
          <AccordionItem value="footer" className="rounded-lg border">
            <AccordionTrigger className="px-4 text-base font-semibold">Footer</AccordionTrigger>
            <AccordionContent className="space-y-4 px-4 pb-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Brand Description</Label>
                  <Input {...register('footer.brandDescription')} />
                </div>
                <div>
                  <Label>Contact Email</Label>
                  <Input type="email" {...register('footer.contactEmail')} />
                </div>
              </div>

              <div>
                <Label className="mb-2 block text-sm font-medium">Product Links</Label>
                {productLinkFields.fields.map((field, idx) => (
                  <div key={field.id} className="mb-2 flex items-center gap-2">
                    <Input placeholder="Label" {...register(`footer.productLinks.${idx}.label`)} />
                    <Input placeholder="URL" {...register(`footer.productLinks.${idx}.href`)} />
                    <Button type="button" variant="ghost" size="sm" onClick={() => productLinkFields.remove(idx)}>
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
                  <Plus className="mr-1.5 size-4" /> Add Link
                </Button>
              </div>

              <div>
                <Label className="mb-2 block text-sm font-medium">Legal Links</Label>
                {legalLinkFields.fields.map((field, idx) => (
                  <div key={field.id} className="mb-2 flex items-center gap-2">
                    <Input placeholder="Label" {...register(`footer.legalLinks.${idx}.label`)} />
                    <Input placeholder="URL" {...register(`footer.legalLinks.${idx}.href`)} />
                    <Button type="button" variant="ghost" size="sm" onClick={() => legalLinkFields.remove(idx)}>
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
                  <Plus className="mr-1.5 size-4" /> Add Link
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </form>

      {/* Reset Confirmation Dialog */}
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
            <AlertDialogAction
              onClick={handleReset}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : null}
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---- Persona Editor Sub-component ----

function PersonaEditor({
  index,
  register,
  control,
  setValue,
  onRemove,
}: {
  index: number;
  register: ReturnType<typeof useForm<HomepageFormData>>['register'];
  control: ReturnType<typeof useForm<HomepageFormData>>['control'];
  setValue: ReturnType<typeof useForm<HomepageFormData>>['setValue'];
  onRemove: () => void;
}) {
  const features: string[] = useWatch({ control, name: `personas.items.${index}.features` }) ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Persona {index + 1}</CardTitle>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>Title</Label>
            <Input {...register(`personas.items.${index}.title`)} />
          </div>
          <div>
            <Label>Plan Name</Label>
            <Input {...register(`personas.items.${index}.plan`)} />
          </div>
          <div>
            <Label>Price</Label>
            <Input {...register(`personas.items.${index}.price`)} placeholder="e.g. 499 or Custom" />
          </div>
        </div>
        <div>
          <Label className="mb-2 block text-sm font-medium">Features</Label>
          {features.map((_: string, fIdx: number) => (
            <div key={fIdx} className="mb-2 flex items-center gap-2">
              <Input
                {...register(`personas.items.${index}.features.${fIdx}`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const updated = features.filter((__, i) => i !== fIdx);
                  setValue(`personas.items.${index}.features`, updated, { shouldDirty: true });
                }}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setValue(`personas.items.${index}.features`, [...features, ''], { shouldDirty: true });
            }}
          >
            <Plus className="mr-1.5 size-4" /> Add Feature
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
