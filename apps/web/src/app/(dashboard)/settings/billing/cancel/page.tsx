'use client';

import Link from 'next/link';
import { XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

export default function CheckoutCancelPage() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="max-w-md space-y-4 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-yellow-100">
          <XIcon className="h-7 w-7 text-yellow-600" />
        </div>

        <h1 className="text-2xl font-bold">Checkout Cancelled</h1>
        <p className="text-sm text-muted-foreground">
          Your checkout was cancelled. No charges have been made. You can try again anytime.
        </p>

        <div className="flex justify-center gap-3 pt-2">
          <Button asChild>
            <Link href="/settings/billing">Back to Billing</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
