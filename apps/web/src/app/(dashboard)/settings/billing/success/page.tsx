'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { CheckIcon, SearchIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

export default function CheckoutSuccessPage() {
  const queryClient = useQueryClient();

  // Invalidate billing queries so the billing page shows the new plan
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['billing'] });
  }, [queryClient]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="max-w-md space-y-4 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
          <CheckIcon className="h-7 w-7 text-green-600" />
        </div>

        <h1 className="text-2xl font-bold">Payment Successful</h1>
        <p className="text-sm text-muted-foreground">
          Your subscription has been activated. You now have access to all the features included in your plan.
        </p>

        <div className="flex justify-center gap-3 pt-2">
          <Button asChild>
            <Link href="/settings/billing">View Billing</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/search">
              <SearchIcon className="mr-1.5 h-3.5 w-3.5" />
              Start Researching
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
