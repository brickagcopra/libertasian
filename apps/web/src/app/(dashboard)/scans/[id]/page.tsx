'use client';

import { useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useScanDetail, useOcrResults, useGenerateDigestFromScan, useDeleteScan } from '@/features/scans/hooks/use-scans';
import { useUpdatePrivacy } from '@/features/scans/hooks/use-update-privacy';
import { useAttachToMatter } from '@/features/scans/hooks/use-attach-to-matter';
import { useGenerateFlashcardsFromScan } from '@/features/scans/hooks/use-generate-flashcards';
import { useGenerateOutlineFromScan } from '@/features/scans/hooks/use-generate-outline';
import type { OutlineSection } from '@/features/scans/types';
import {
  UpgradeBanner,
  isSubscriptionTier403,
} from '@/components/paywall/upgrade-banner';
import { ROUTES } from '@/lib/constants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FileTextIcon,
  TrashIcon,
  SparklesIcon,
  ShieldIcon,
  ShieldAlertIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  LoaderIcon,
  LinkIcon,
  WalletCardsIcon,
  ListTreeIcon,
} from 'lucide-react';

function qualityLabel(score: number | null): { label: string; className: string } {
  if (score === null) return { label: 'N/A', className: 'text-muted-foreground' };
  if (score < 0.2) return { label: `Low (${(score * 100).toFixed(0)}%)`, className: 'text-red-600' };
  if (score < 0.4) return { label: `Fair (${(score * 100).toFixed(0)}%)`, className: 'text-yellow-600' };
  return { label: `Good (${(score * 100).toFixed(0)}%)`, className: 'text-green-600' };
}

export default function ScanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [showPrivacyDialog, setShowPrivacyDialog] = useState(false);
  const [showMatterDialog, setShowMatterDialog] = useState(false);
  const [showFlashcardDialog, setShowFlashcardDialog] = useState(false);
  const [matterIdInput, setMatterIdInput] = useState('');
  const [flashcardSetIdInput, setFlashcardSetIdInput] = useState('');
  const [flashcardCount, setFlashcardCount] = useState(10);
  const [flashcardCardType, setFlashcardCardType] = useState('mixed');

  const { data: scanRes, isLoading } = useScanDetail(id ?? null);
  const scan = scanRes?.data ?? null;

  const ocrEnabled = !!scan && scan.ocrStatus !== 'pending';
  const { data: ocrRes, isLoading: isLoadingOcr } = useOcrResults(id ?? null, ocrEnabled);
  const ocrData = ocrRes?.data ?? null;

  const digestMutation = useGenerateDigestFromScan();
  const deleteMutation = useDeleteScan();
  const privacyMutation = useUpdatePrivacy();
  const attachMutation = useAttachToMatter();
  const flashcardMutation = useGenerateFlashcardsFromScan();
  const outlineMutation = useGenerateOutlineFromScan();

  const handleTogglePrivacy = useCallback(() => {
    if (!id || !scan) return;
    const isPrivate = scan.privacyLevel === 'private';
    privacyMutation.mutate({
      uploadId: id,
      privacyLevel: isPrivate ? 'editorial_candidate' : 'private',
    });
    setShowPrivacyDialog(false);
  }, [id, scan, privacyMutation]);

  const handlePrivacyClick = useCallback(() => {
    if (!scan) return;
    if (scan.privacyLevel === 'private') {
      setShowPrivacyDialog(true);
    } else {
      handleTogglePrivacy();
    }
  }, [scan, handleTogglePrivacy]);

  const handleGenerateDigest = useCallback(() => {
    if (!id) return;
    digestMutation.mutate({ uploadId: id });
  }, [id, digestMutation]);

  const handleAttachToMatter = useCallback(() => {
    if (!id || !matterIdInput.trim()) return;
    attachMutation.mutate(
      { uploadId: id, matterId: matterIdInput.trim() },
      { onSuccess: () => { setShowMatterDialog(false); setMatterIdInput(''); } },
    );
  }, [id, matterIdInput, attachMutation]);

  const handleGenerateFlashcards = useCallback(() => {
    if (!id || !flashcardSetIdInput.trim()) return;
    flashcardMutation.mutate(
      {
        uploadId: id,
        flashcardSetId: flashcardSetIdInput.trim(),
        cardType: flashcardCardType,
        count: flashcardCount,
      },
      {
        onSuccess: () => { setShowFlashcardDialog(false); setFlashcardSetIdInput(''); },
        // AI flashcard generation is an Edu+ entitlement. Swap the dialog
        // for the upsell rather than leaving the button silently dead.
        onError: (err) => {
          if (isSubscriptionTier403(err)) setShowFlashcardDialog(false);
        },
      },
    );
  }, [id, flashcardSetIdInput, flashcardCardType, flashcardCount, flashcardMutation]);

  const flashcardTierLocked = isSubscriptionTier403(flashcardMutation.error);

  const handleGenerateOutline = useCallback(() => {
    if (!id) return;
    outlineMutation.mutate({ uploadId: id });
  }, [id, outlineMutation]);

  const handleDelete = useCallback(() => {
    if (!id) return;
    deleteMutation.mutate(id, {
      onSuccess: () => router.push(ROUTES.SCANS),
    });
  }, [id, deleteMutation, router]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (!scan) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <FileTextIcon className="size-12 text-muted-foreground/50" />
          <h2 className="mt-3 text-lg font-semibold">Scan not found</h2>
          <p className="mt-2 text-sm text-muted-foreground">This scan may have been deleted.</p>
          <Button variant="link" asChild className="mt-4">
            <Link href={ROUTES.SCANS}>Back to Scans</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const quality = scan.cameraCaptures[0]?.captureQualityScore ?? null;
  const qualityInfo = qualityLabel(quality);
  const citations = ocrData?.extractedCitations?.citations ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href={ROUTES.SCANS} className="hover:text-foreground">Scans</Link>
            <span>/</span>
            <span className="text-foreground">{scan.id.slice(0, 8)}</span>
          </div>
          <h1 className="mt-1 text-xl font-bold">
            {scan.originalFilename ?? `Scan ${scan.id.slice(0, 8)}`}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {scan.processingStatus === 'completed' && (
            <>
              <Button
                onClick={handleGenerateDigest}
                disabled={digestMutation.isPending}
              >
                {digestMutation.isPending ? (
                  <LoaderIcon className="animate-spin" />
                ) : (
                  <SparklesIcon />
                )}
                {digestMutation.isPending ? 'Generating...' : 'Generate Digest'}
              </Button>

              {/* Generate Flashcards Dialog */}
              <Dialog open={showFlashcardDialog} onOpenChange={setShowFlashcardDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <WalletCardsIcon />
                    Flashcards
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Generate Flashcards from Scan</DialogTitle>
                    <DialogDescription>
                      AI will create flashcards from the extracted text. Cards are saved to the specified flashcard set.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label htmlFor="fc-set-id">Flashcard Set ID</Label>
                      <Input
                        id="fc-set-id"
                        placeholder="Paste flashcard set UUID"
                        value={flashcardSetIdInput}
                        onChange={(e) => setFlashcardSetIdInput(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="fc-type">Card Type</Label>
                        <Select value={flashcardCardType} onValueChange={setFlashcardCardType}>
                          <SelectTrigger id="fc-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="mixed">Mixed</SelectItem>
                            <SelectItem value="definition">Definition</SelectItem>
                            <SelectItem value="application">Application</SelectItem>
                            <SelectItem value="case_holding">Case Holding</SelectItem>
                            <SelectItem value="provision">Provision</SelectItem>
                            <SelectItem value="doctrine">Doctrine</SelectItem>
                            <SelectItem value="procedure">Procedure</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="fc-count">Count</Label>
                        <Input
                          id="fc-count"
                          type="number"
                          min={1}
                          max={30}
                          value={flashcardCount}
                          onChange={(e) => setFlashcardCount(Number(e.target.value))}
                        />
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={handleGenerateFlashcards}
                      disabled={flashcardMutation.isPending || !flashcardSetIdInput.trim()}
                    >
                      {flashcardMutation.isPending ? (
                        <LoaderIcon className="animate-spin" />
                      ) : (
                        <WalletCardsIcon />
                      )}
                      {flashcardMutation.isPending ? 'Generating...' : 'Generate'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Generate Outline */}
              <Button
                variant="outline"
                onClick={handleGenerateOutline}
                disabled={outlineMutation.isPending}
              >
                {outlineMutation.isPending ? (
                  <LoaderIcon className="animate-spin" />
                ) : (
                  <ListTreeIcon />
                )}
                {outlineMutation.isPending ? 'Generating...' : 'Outline'}
              </Button>

              {/* Attach to Matter Dialog */}
              <Dialog open={showMatterDialog} onOpenChange={setShowMatterDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <LinkIcon />
                    Link to Matter
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Attach to Matter</DialogTitle>
                    <DialogDescription>
                      Link this scan to a workspace matter as a reference document.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2 py-2">
                    <Label htmlFor="matter-id">Matter ID</Label>
                    <Input
                      id="matter-id"
                      placeholder="Paste matter UUID"
                      value={matterIdInput}
                      onChange={(e) => setMatterIdInput(e.target.value)}
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={handleAttachToMatter}
                      disabled={attachMutation.isPending || !matterIdInput.trim()}
                    >
                      {attachMutation.isPending ? (
                        <LoaderIcon className="animate-spin" />
                      ) : (
                        <LinkIcon />
                      )}
                      {attachMutation.isPending ? 'Attaching...' : 'Attach'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="icon" disabled={deleteMutation.isPending}>
                <TrashIcon />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete scan?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the scan and all associated data.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Digest success */}
      {digestMutation.isSuccess && digestMutation.data?.data?.digestId && (
        <Alert>
          <CheckCircleIcon className="size-4 text-green-600" />
          <AlertDescription>
            Digest generated successfully.{' '}
            <Link
              href={ROUTES.DIGEST(digestMutation.data.data.digestId)}
              className="font-medium underline hover:no-underline"
            >
              View Digest
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {digestMutation.isError && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>
            {digestMutation.error?.message ?? 'Failed to generate digest'}
          </AlertDescription>
        </Alert>
      )}

      {/* Flashcard generation alerts */}
      {flashcardMutation.isSuccess && (
        <Alert>
          <CheckCircleIcon className="size-4 text-green-600" />
          <AlertDescription>
            Generated {flashcardMutation.data?.data?.generatedCount ?? 0} flashcards successfully.
          </AlertDescription>
        </Alert>
      )}
      {flashcardMutation.isError && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>
            {flashcardMutation.error?.message ?? 'Failed to generate flashcards'}
          </AlertDescription>
        </Alert>
      )}

      {/* Outline generation alerts */}
      {outlineMutation.isError && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>
            {outlineMutation.error?.message ?? 'Failed to generate outline'}
          </AlertDescription>
        </Alert>
      )}

      {/* Matter attachment alerts */}
      {attachMutation.isSuccess && (
        <Alert>
          <CheckCircleIcon className="size-4 text-green-600" />
          <AlertDescription>
            Scan attached to matter successfully.
          </AlertDescription>
        </Alert>
      )}
      {attachMutation.isError && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>
            {attachMutation.error?.message ?? 'Failed to attach to matter'}
          </AlertDescription>
        </Alert>
      )}

      {/* Info cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground">Status</p>
            <p className="mt-1 text-sm font-semibold capitalize">{scan.processingStatus}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground">OCR Status</p>
            <p className="mt-1 text-sm font-semibold capitalize">{scan.ocrStatus}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground">Pages</p>
            <p className="mt-1 text-sm font-semibold">{scan.pageCount ?? 1}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground">Quality</p>
            <p className={`mt-1 text-sm font-semibold ${qualityInfo.className}`}>
              {qualityInfo.label}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Metadata row */}
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          Privacy:
          <Badge variant="secondary" className="capitalize">
            {scan.privacyLevel === 'private' ? (
              <ShieldIcon className="size-3" />
            ) : (
              <ShieldAlertIcon className="size-3" />
            )}
            {scan.privacyLevel.replace('_', ' ')}
          </Badge>
          {/* Privacy toggle with AlertDialog for editorial candidate */}
          <AlertDialog open={showPrivacyDialog} onOpenChange={setShowPrivacyDialog}>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrivacyClick}
              disabled={privacyMutation.isPending}
              className="h-7 text-xs"
            >
              {privacyMutation.isPending
                ? 'Updating...'
                : scan.privacyLevel === 'private'
                  ? 'Mark as Editorial Candidate'
                  : 'Set to Private'}
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Mark as Editorial Candidate?</AlertDialogTitle>
                <AlertDialogDescription>
                  By changing to &apos;editorial candidate&apos;, this scan may be reviewed by
                  LIBERTASIAN editors for inclusion in the public legal corpus. Your personal
                  information will not be shared.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleTogglePrivacy}>
                  Continue
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </span>
        {scan.classifiedDocumentType && (
          <span>
            Type: <strong className="capitalize text-foreground">{scan.classifiedDocumentType}</strong>
          </span>
        )}
        <span>Uploaded: {new Date(scan.createdAt).toLocaleString()}</span>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="ocr">
        <TabsList>
          <TabsTrigger value="ocr">OCR Text</TabsTrigger>
          <TabsTrigger value="citations">Citations ({citations.length})</TabsTrigger>
          {outlineMutation.isSuccess && <TabsTrigger value="outline">Outline</TabsTrigger>}
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        <TabsContent value="ocr" className="min-h-[300px]">
          {isLoadingOcr ? (
            <div className="flex items-center justify-center py-12">
              <LoaderIcon className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : ocrData?.ocrText ? (
            <Card>
              <CardContent className="p-6">
                <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed">
                  {ocrData.ocrText}
                </pre>
              </CardContent>
            </Card>
          ) : (
            <EmptyTabContent
              message={
                ocrData?.ocrStatus === 'processing'
                  ? 'OCR is still processing...'
                  : ocrData?.ocrStatus === 'failed'
                    ? 'OCR processing failed.'
                    : 'No text extracted yet.'
              }
            />
          )}
        </TabsContent>

        <TabsContent value="citations" className="min-h-[300px]">
          {citations.length > 0 ? (
            <div className="space-y-2">
              {citations.map((c, i) => (
                <Card key={i}>
                  <CardContent className="flex items-center gap-3 p-3">
                    <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 uppercase">
                      {c.documentType}
                    </Badge>
                    <span className="text-sm">{c.normalized || c.text}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyTabContent message="No citations extracted." />
          )}
        </TabsContent>

        {outlineMutation.isSuccess && outlineMutation.data?.data?.outline && (
          <TabsContent value="outline" className="min-h-[300px]">
            <Card>
              <CardHeader>
                <CardTitle>{outlineMutation.data.data.outline.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {outlineMutation.data.data.outline.sections.map((section: OutlineSection, i: number) => (
                  <div key={i} className="space-y-2">
                    <h3 className="font-semibold">{i + 1}. {section.heading}</h3>
                    <ul className="ml-6 list-disc space-y-1 text-sm text-muted-foreground">
                      {section.key_points.map((point: string, j: number) => (
                        <li key={j}>{point}</li>
                      ))}
                    </ul>
                    {section.subsections?.map((sub, k: number) => (
                      <div key={k} className="ml-6 space-y-1">
                        <h4 className="text-sm font-medium">{i + 1}.{k + 1}. {sub.heading}</h4>
                        <ul className="ml-6 list-disc space-y-1 text-sm text-muted-foreground">
                          {sub.key_points.map((point: string, l: number) => (
                            <li key={l}>{point}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {i < outlineMutation.data!.data.outline.sections.length - 1 && (
                      <Separator className="mt-3" />
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="details" className="min-h-[300px]">
          <Card>
            <CardContent className="divide-y p-0">
              <DetailRow label="Upload ID" value={scan.id} />
              <DetailRow label="Processing Status" value={scan.processingStatus} capitalize />
              <DetailRow label="OCR Status" value={scan.ocrStatus} capitalize />
              <DetailRow label="Privacy Level" value={scan.privacyLevel.replace('_', ' ')} capitalize />
              <DetailRow label="Pages" value={String(scan.pageCount ?? 1)} />
              {scan.classifiedDocumentType && (
                <DetailRow label="Document Type" value={scan.classifiedDocumentType} capitalize />
              )}
              {ocrData?.pages?.map((page) => (
                <div key={page.id}>
                  <DetailRow
                    label={`Page ${page.pageNumber} Confidence`}
                    value={page.ocrConfidence ? `${(page.ocrConfidence * 100).toFixed(0)}%` : 'N/A'}
                  />
                  <DetailRow
                    label={`Page ${page.pageNumber} Words`}
                    value={String(page.wordCount ?? 0)}
                  />
                </div>
              ))}
              {scan.processingJobs.map((job) => (
                <DetailRow
                  key={job.id}
                  label={`Job: ${job.jobType}`}
                  value={`${job.status}${job.errorMessage ? ` — ${job.errorMessage}` : ''}`}
                  capitalize
                />
              ))}
              <DetailRow label="Created" value={new Date(scan.createdAt).toLocaleString()} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {flashcardTierLocked && (
        <UpgradeBanner
          variant="modal"
          corpus="derivatives"
          message="AI flashcard generation is available on Edu plans and above. Upgrade to turn your scans into study sets."
          surface="scans/detail/generate-flashcards"
        />
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${capitalize ? 'capitalize' : ''}`}>{value}</span>
    </div>
  );
}

function EmptyTabContent({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <FileTextIcon className="size-12 opacity-50" />
      <p className="mt-3 text-sm">{message}</p>
    </div>
  );
}
