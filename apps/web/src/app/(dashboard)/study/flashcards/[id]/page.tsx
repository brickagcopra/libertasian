'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useFlashcardSet } from '@/features/study/hooks/use-flashcard-sets';
import {
  useFlashcards,
  useCreateFlashcard,
  useDeleteFlashcard,
} from '@/features/study/hooks/use-flashcards';
import { useUpsertStudyProgress } from '@/features/study/hooks/use-study-progress';
import {
  useFlashcardReviewStats,
  useSubmitFlashcardReview,
} from '@/features/study/hooks/use-flashcard-reviews';
import {
  useStartStudySession,
  useEndStudySession,
} from '@/features/study/hooks/use-study-sessions';
import { useExportFlashcardSet } from '@/features/study/hooks/use-study-export';
import { ROUTES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { AlertCircleIcon, PlusIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon } from 'lucide-react';
import type { Flashcard, ExportFormat, SubmitFlashcardReviewInput } from '@/features/study/types';

const VISIBILITY_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  private: { variant: 'secondary' },
  org: { variant: 'outline', className: 'border-purple-200 bg-purple-50 text-purple-700' },
  public_editorial: { variant: 'outline', className: 'border-blue-200 bg-blue-50 text-blue-700' },
};

export default function FlashcardSetDetailPage() {
  const params = useParams();
  const id = params['id'] as string;

  const { data: set, isLoading: setLoading, error: setError } = useFlashcardSet(id);
  const { data: cardsData, isLoading: cardsLoading } = useFlashcards(id);
  const { data: reviewStatsData } = useFlashcardReviewStats(id);
  const deleteCardMutation = useDeleteFlashcard();
  const exportMutation = useExportFlashcardSet();
  const progressMutation = useUpsertStudyProgress();

  const cards = cardsData?.data ?? [];
  const reviewStats = reviewStatsData?.data;
  const [mode, setMode] = useState<'list' | 'player' | 'review'>('list');
  const [showAddCard, setShowAddCard] = useState(false);

  const handleDeleteCard = useCallback(
    (cardId: string) => {
      if (window.confirm('Delete this flashcard?')) {
        deleteCardMutation.mutate({ id: cardId, setId: id });
      }
    },
    [deleteCardMutation, id],
  );

  const handleStartStudy = useCallback(() => {
    if (cards.length === 0) return;
    setMode('player');
    progressMutation.mutate({
      entityType: 'flashcard_set',
      entityId: id,
      data: { status: 'in_progress' },
    });
  }, [cards.length, id, progressMutation]);

  const handleStartReview = useCallback(() => {
    if (cards.length === 0) return;
    setMode('review');
    progressMutation.mutate({
      entityType: 'flashcard_set',
      entityId: id,
      data: { status: 'in_progress' },
    });
  }, [cards.length, id, progressMutation]);

  if (setLoading || cardsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (setError || !set) {
    return (
      <div className="space-y-4">
        <Link href={ROUTES.STUDY_FLASHCARDS} className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Back to flashcard sets
        </Link>
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>
            {setError instanceof Error ? setError.message : 'Flashcard set not found'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if ((mode === 'player' || mode === 'review') && cards.length > 0) {
    return (
      <FlashcardPlayer
        cards={cards}
        setId={id}
        setTitle={set.title}
        barSubject={set.barSubject ?? undefined}
        reviewMode={mode === 'review'}
        onExit={() => setMode('list')}
        onComplete={() => {
          progressMutation.mutate({
            entityType: 'flashcard_set',
            entityId: id,
            data: { status: 'completed', progressPct: 100 },
          });
          setMode('list');
        }}
      />
    );
  }

  const visStyle = VISIBILITY_BADGE[set.visibility] ?? { variant: 'secondary' as const };

  return (
    <div className="space-y-6">
      <Link href={ROUTES.STUDY_FLASHCARDS} className="text-sm text-muted-foreground hover:text-foreground">
        &larr; Back to flashcard sets
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">{set.title}</h1>
        {set.description && (
          <p className="mt-1 text-sm text-muted-foreground">{set.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {set.cardCount} card{set.cardCount !== 1 ? 's' : ''}
          </Badge>
          {set.barSubject && <Badge variant="secondary">{set.barSubject}</Badge>}
          <Badge variant={visStyle.variant} className={visStyle.className}>
            {set.visibility.replace(/_/g, ' ')}
          </Badge>
          {reviewStats && reviewStats.dueCount > 0 && (
            <Badge variant="destructive">
              {reviewStats.dueCount} due
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            Updated {new Date(set.updatedAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Review Stats Summary */}
      {reviewStats && reviewStats.totalReviews > 0 && (
        <Card className="bg-muted/30">
          <CardContent className="flex items-center gap-6 p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Reviews</p>
              <p className="text-lg font-bold">{reviewStats.totalReviews}</p>
            </div>
            <Separator orientation="vertical" className="h-8" />
            <div className="flex gap-3">
              {(['again', 'hard', 'good', 'easy'] as const).map((response) => (
                <div key={response} className="text-center">
                  <p className="text-xs text-muted-foreground capitalize">{response}</p>
                  <p className="text-sm font-semibold">
                    {reviewStats.responseBreakdown[response] ?? 0}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={handleStartStudy} disabled={cards.length === 0}>
          Study Cards
        </Button>
        <Button
          variant="outline"
          onClick={handleStartReview}
          disabled={cards.length === 0}
          className={reviewStats && reviewStats.dueCount > 0 ? 'border-orange-300 text-orange-700 hover:bg-orange-50' : ''}
        >
          Review Mode
          {reviewStats && reviewStats.dueCount > 0 && (
            <Badge variant="destructive" className="ml-2 text-xs">
              {reviewStats.dueCount}
            </Badge>
          )}
        </Button>
        <Button variant="outline" onClick={() => setShowAddCard(true)}>
          <PlusIcon className="mr-2 size-4" />
          Add Card
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={cards.length === 0 || exportMutation.isPending}>
              <DownloadIcon className="mr-2 size-4" />
              {exportMutation.isPending ? 'Exporting...' : 'Export'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => exportMutation.mutate({ id, format: 'pdf' as ExportFormat })}>
              Export as PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportMutation.mutate({ id, format: 'docx' as ExportFormat })}>
              Export as DOCX
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Cards List */}
      {cards.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">No flashcards yet.</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Add your first card above to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {cards.map((card, index) => (
            <Card key={card.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground/60">#{index + 1}</span>
                      <Badge variant="secondary">
                        {card.sourceType.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm font-medium">{card.front}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{card.back}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteCard(card.id)}
                    className="shrink-0 text-destructive hover:text-destructive"
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AddCardDialog
        setId={id}
        open={showAddCard}
        onClose={() => setShowAddCard(false)}
      />
    </div>
  );
}

// -- Add Card Dialog ----------------------------------------------------------

function AddCardDialog({
  setId,
  open,
  onClose,
}: {
  setId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const createCardMutation = useCreateFlashcard();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!front.trim() || !back.trim()) return;

      createCardMutation.mutate(
        {
          setId,
          data: {
            front: front.trim(),
            back: back.trim(),
          },
        },
        {
          onSuccess: () => {
            setFront('');
            setBack('');
            onClose();
          },
        },
      );
    },
    [front, back, setId, createCardMutation, onClose],
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Flashcard</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="card-front">Front (Question) *</Label>
            <Textarea
              id="card-front"
              value={front}
              onChange={(e) => setFront(e.target.value)}
              placeholder="Enter the question or prompt..."
              rows={3}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="card-back">Back (Answer) *</Label>
            <Textarea
              id="card-back"
              value={back}
              onChange={(e) => setBack(e.target.value)}
              placeholder="Enter the answer..."
              rows={3}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createCardMutation.isPending || !front.trim() || !back.trim()}
            >
              {createCardMutation.isPending ? 'Adding...' : 'Add Card'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -- Review Response Button Config --------------------------------------------

const REVIEW_BUTTONS: {
  response: SubmitFlashcardReviewInput['response'];
  label: string;
  shortcut: string;
  className: string;
}[] = [
  {
    response: 'again',
    label: 'Again',
    shortcut: '1',
    className: 'border-red-300 text-red-700 hover:bg-red-50',
  },
  {
    response: 'hard',
    label: 'Hard',
    shortcut: '2',
    className: 'border-orange-300 text-orange-700 hover:bg-orange-50',
  },
  {
    response: 'good',
    label: 'Good',
    shortcut: '3',
    className: 'border-green-300 text-green-700 hover:bg-green-50',
  },
  {
    response: 'easy',
    label: 'Easy',
    shortcut: '4',
    className: 'border-blue-300 text-blue-700 hover:bg-blue-50',
  },
];

// -- Flashcard Player ---------------------------------------------------------

function FlashcardPlayer({
  cards,
  setId,
  setTitle,
  barSubject,
  reviewMode,
  onExit,
  onComplete,
}: {
  cards: Flashcard[];
  setId: string;
  setTitle: string;
  barSubject?: string;
  reviewMode: boolean;
  onExit: () => void;
  onComplete: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);

  const submitReview = useSubmitFlashcardReview();
  const startSession = useStartStudySession();
  const endSession = useEndStudySession();
  const sessionIdRef = useRef<string | null>(null);

  const card = cards[currentIndex];
  const progress = cards.length > 0 ? ((currentIndex + 1) / cards.length) * 100 : 0;

  // Start a study session on mount
  useEffect(() => {
    startSession.mutate(
      {
        entityType: 'flashcard_set',
        entityId: setId,
        barSubject,
      },
      {
        onSuccess: (data) => {
          sessionIdRef.current = data.data.id;
        },
      },
    );
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // End session on unmount or exit
  const endCurrentSession = useCallback(
    (itemsStudied: number) => {
      if (sessionIdRef.current) {
        endSession.mutate({
          sessionId: sessionIdRef.current,
          input: {
            itemsStudied,
            itemsCorrect: reviewedCount,
          },
        });
        sessionIdRef.current = null;
      }
    },
    [endSession, reviewedCount],
  );

  const handleFlip = () => setIsFlipped(!isFlipped);

  const handleReviewResponse = useCallback(
    (response: SubmitFlashcardReviewInput['response']) => {
      if (!card) return;
      submitReview.mutate(
        {
          flashcardId: card.id,
          input: { response },
        },
        {
          onSuccess: () => {
            setReviewedCount((c) => c + 1);
            setIsFlipped(false);
            if (currentIndex < cards.length - 1) {
              setCurrentIndex(currentIndex + 1);
            } else {
              endCurrentSession(cards.length);
              onComplete();
            }
          },
        },
      );
    },
    [card, submitReview, currentIndex, cards.length, onComplete, endCurrentSession],
  );

  const handleNext = useCallback(() => {
    setIsFlipped(false);
    if (currentIndex < cards.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      endCurrentSession(currentIndex + 1);
      onComplete();
    }
  }, [currentIndex, cards.length, onComplete, endCurrentSession]);

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setIsFlipped(false);
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex]);

  const handleExit = useCallback(() => {
    endCurrentSession(currentIndex + 1);
    onExit();
  }, [onExit, endCurrentSession, currentIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        handleFlip();
      } else if (e.key === 'Escape') {
        handleExit();
      }

      if (reviewMode && isFlipped) {
        // Number keys for review responses
        if (e.key === '1') handleReviewResponse('again');
        else if (e.key === '2') handleReviewResponse('hard');
        else if (e.key === '3') handleReviewResponse('good');
        else if (e.key === '4') handleReviewResponse('easy');
      } else {
        if (e.key === 'ArrowRight') handleNext();
        else if (e.key === 'ArrowLeft') handlePrev();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentIndex, isFlipped, reviewMode],
  );

  if (!card) return null;

  return (
    <div
      className="flex min-h-[70vh] flex-col items-center"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Header */}
      <div className="mb-6 flex w-full max-w-xl items-center justify-between">
        <Button variant="ghost" size="sm" onClick={handleExit}>
          <ChevronLeftIcon className="mr-1 size-4" />
          Exit
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{setTitle}</span>
          {reviewMode && (
            <Badge variant="outline" className="border-orange-300 text-orange-700">
              Review
            </Badge>
          )}
        </div>
        <span className="text-sm text-muted-foreground">
          {currentIndex + 1} / {cards.length}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="mb-8 w-full max-w-xl">
        <Progress value={progress} className="h-1.5" />
      </div>

      {/* Card with Flip Animation */}
      <div
        className="mb-6 w-full max-w-xl cursor-pointer"
        onClick={handleFlip}
        style={{ perspective: '1000px' }}
      >
        <div
          className="relative h-72 transition-transform duration-500"
          style={{
            transformStyle: 'preserve-3d',
            transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          {/* Front */}
          <Card
            className="absolute inset-0 flex items-center justify-center border-2 p-8"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div className="text-center">
              <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Question</p>
              <p className="text-lg leading-relaxed">{card.front}</p>
            </div>
          </Card>

          {/* Back */}
          <Card
            className="absolute inset-0 flex items-center justify-center border-2 border-primary bg-muted p-8"
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            <div className="text-center">
              <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Answer</p>
              <p className="text-lg leading-relaxed">{card.back}</p>
            </div>
          </Card>
        </div>
      </div>

      {/* Hint */}
      <p className="mb-6 text-xs text-muted-foreground/60">
        {reviewMode
          ? 'Click card or press Space to flip. Press 1-4 to rate. Esc to exit.'
          : 'Click card or press Space to flip. Arrow keys to navigate. Esc to exit.'}
      </p>

      {/* Review Buttons (shown in review mode when card is flipped) */}
      {reviewMode && isFlipped ? (
        <div className="flex gap-3">
          {REVIEW_BUTTONS.map((btn) => (
            <Button
              key={btn.response}
              variant="outline"
              onClick={() => handleReviewResponse(btn.response)}
              disabled={submitReview.isPending}
              className={btn.className}
            >
              <span className="mr-1.5 text-xs opacity-50">{btn.shortcut}</span>
              {btn.label}
            </Button>
          ))}
        </div>
      ) : !reviewMode ? (
        /* Navigation (standard mode only) */
        <div className="flex gap-4">
          <Button
            variant="outline"
            onClick={handlePrev}
            disabled={currentIndex === 0}
          >
            <ChevronLeftIcon className="mr-2 size-4" />
            Previous
          </Button>
          <Button onClick={handleNext}>
            {currentIndex === cards.length - 1 ? 'Complete' : 'Next'}
            {currentIndex < cards.length - 1 && <ChevronRightIcon className="ml-2 size-4" />}
          </Button>
        </div>
      ) : (
        /* Review mode but not flipped - prompt to flip */
        <p className="text-sm text-muted-foreground">Flip the card to rate your recall</p>
      )}

      {/* Reviewed count */}
      {reviewMode && reviewedCount > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Reviewed {reviewedCount} of {cards.length} cards this session
        </p>
      )}
    </div>
  );
}
