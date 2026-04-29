'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

export interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string | React.ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  confirmVariant?: 'default' | 'destructive';
  requireTypedConfirmation?: string;
  onConfirm: () => void | Promise<void>;
  isPending?: boolean;
  errorMessage?: string | null;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  confirmVariant = 'default',
  requireTypedConfirmation,
  onConfirm,
  isPending = false,
  errorMessage = null,
}: ConfirmActionDialogProps) {
  const [typed, setTyped] = useState('');
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTyped('');
      // Autofocus the typed-confirm input when the dialog opens.
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  const requiresTyped = !!requireTypedConfirmation;
  const typedMatches = requiresTyped
    ? typed.trim() === requireTypedConfirmation!.trim()
    : true;
  const confirmDisabled = isPending || !typedMatches;

  const handleConfirm = async () => {
    if (confirmDisabled) return;
    await onConfirm();
  };

  // Block close while a mutation is in flight so the user can read the error.
  const handleOpenChange = (next: boolean) => {
    if (isPending && !next) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-muted-foreground text-sm">{description}</div>
          </DialogDescription>
        </DialogHeader>

        {requiresTyped && (
          <div className="space-y-2">
            <Label htmlFor={inputId} className="text-xs font-medium">
              Type{' '}
              <span className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                {requireTypedConfirmation}
              </span>{' '}
              to confirm
            </Label>
            <Input
              id={inputId}
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requireTypedConfirmation}
              autoComplete="off"
              spellCheck={false}
              disabled={isPending}
              aria-describedby={errorMessage ? `${inputId}-error` : undefined}
            />
          </div>
        )}

        {errorMessage && (
          <Alert variant="destructive" id={`${inputId}-error`}>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            onClick={handleConfirm}
            disabled={confirmDisabled}
            aria-disabled={confirmDisabled}
          >
            {isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
            {isPending ? (pendingLabel ?? `${confirmLabel}…`) : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
