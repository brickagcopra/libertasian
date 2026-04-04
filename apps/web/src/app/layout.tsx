import type { Metadata } from 'next';

import '@/app/globals.css';
import { AnalyticsProvider } from '@/providers/analytics-provider';
import { AuthProvider } from '@/providers/auth-provider';
import { QueryProvider } from '@/providers/query-provider';
import { ThemeProvider } from '@/providers/theme-provider';

// Skip static prerendering for all pages. This SPA-style app is fully
// client-rendered and auth-gated. Static generation hits a known Next.js 15
// workUnitAsyncStorage bug exacerbated by OneDrive path casing on Windows.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'LIBERTASIAN — Philippine Legal AI Platform',
  description: 'AI-powered Philippine legal research, case digests, and codal reading',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>
              <AnalyticsProvider>{children}</AnalyticsProvider>
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
