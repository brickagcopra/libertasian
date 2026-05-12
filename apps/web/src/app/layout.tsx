import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import '@/app/globals.css';
import { AnalyticsProvider } from '@/providers/analytics-provider';
import { AuthProvider } from '@/providers/auth-provider';
import { QueryProvider } from '@/providers/query-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import { AdProvider } from '@/components/ads/AdProvider';
import { AdRenderer } from '@/components/ads/AdRenderer';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap',
});

// Skip static prerendering for all pages. This SPA-style app is fully
// client-rendered and auth-gated. Static generation hits a known Next.js 15
// workUnitAsyncStorage bug exacerbated by OneDrive path casing on Windows.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: {
    default: 'LIBERTASIAN — Philippine Legal AI Platform',
    template: '%s — LIBERTASIAN',
  },
  description: 'AI-powered Philippine legal research, case digests, and codal reading',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>
              <AnalyticsProvider>
                <AdProvider>
                  {children}
                  <AdRenderer />
                </AdProvider>
              </AnalyticsProvider>
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
