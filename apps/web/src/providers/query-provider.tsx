'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiClientError } from '@/lib/api-client';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            // One retry, except for 409s: a session_displaced answer will not
            // change until the user picks "Use it here".
            retry: (failureCount, error) =>
              !(error instanceof ApiClientError && error.statusCode === 409) && failureCount < 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
