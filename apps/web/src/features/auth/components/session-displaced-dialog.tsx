'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import { useSessionDisplacedStore } from '@/lib/session-displaced';
import { useAuthStore } from '@/stores/auth-store';

import { useLogout } from '../hooks/use-auth';

/**
 * Shown when the API answers 409 session_displaced: the plan allows only so
 * many devices in use at once and another device took this one's slot.
 * "Use it here" claims the slot back (the other device then sees this same
 * prompt) and refetches everything that failed. The dialog cannot be
 * dismissed: every authenticated request keeps failing until the user picks.
 */
export function SessionDisplacedDialog() {
  const displaced = useSessionDisplacedStore((s) => s.displaced);
  const setDisplaced = useSessionDisplacedStore((s) => s.setDisplaced);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const queryClient = useQueryClient();
  const logout = useLogout();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A flag left from a previous session must not greet the next sign-in.
  useEffect(() => {
    if (!isAuthenticated) setDisplaced(false);
  }, [isAuthenticated, setDisplaced]);

  const continueHere = async () => {
    setClaiming(true);
    setError(null);
    try {
      await apiClient.post('/auth/sessions/claim');
      setDisplaced(false);
      await queryClient.invalidateQueries();
    } catch {
      setError('Could not switch to this device. Check your connection and try again.');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <AlertDialog open={displaced && isAuthenticated}>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>You&apos;re using LIBERTASIAN on another device</AlertDialogTitle>
          <AlertDialogDescription>
            Your account can be used on a limited number of devices at the same time.
            Continue here and the other device will be paused.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={claiming || logout.isPending}
            onClick={() => logout.mutate()}
          >
            Sign out
          </Button>
          <Button disabled={claiming || logout.isPending} onClick={() => void continueHere()}>
            {claiming ? 'Switching…' : 'Use it here'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
