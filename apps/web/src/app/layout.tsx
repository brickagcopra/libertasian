import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Toaster } from 'sonner';

import '@/app/globals.css';
import { AnalyticsProvider } from '@/providers/analytics-provider';
import { AuthProvider } from '@/providers/auth-provider';
import { QueryProvider } from '@/providers/query-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import { AdProvider } from '@/components/ads/AdProvider';
import { AdRenderer } from '@/components/ads/AdRenderer';
import { ChatWidget } from '@/components/chat/chat-widget';

// Fonts are self-hosted from ./fonts rather than fetched from the Google Fonts
// CDN at build time. That fetch runs inside the Docker build, where the image
// scanner grants no network — two "Container Image Scan (web)" failures in a
// row (Fraunces, then JetBrains Mono) on PRs that touched no web code at all.
//
// Each file is the latin-subset variable woff2 Google serves today for the
// specs these declarations replaced, so rendering is unchanged. The weight
// RANGES below are the ranges the variable files actually carry — wider than
// the discrete weights we request, which costs nothing because it is one file
// either way. Refresh by re-fetching css2 with a Chrome UA and taking the
// `/* latin */` block's src.
const inter = localFont({
  src: './fonts/inter-latin-variable.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-inter',
  display: 'swap',
});

const fraunces = localFont({
  src: [
    { path: './fonts/fraunces-latin-variable.woff2', weight: '100 900', style: 'normal' },
    {
      path: './fonts/fraunces-latin-variable-italic.woff2',
      weight: '100 900',
      style: 'italic',
    },
  ],
  variable: '--font-fraunces',
  display: 'swap',
});

const jetbrainsMono = localFont({
  src: './fonts/jetbrains-mono-latin-variable.woff2',
  weight: '100 800',
  style: 'normal',
  variable: '--font-jetbrains-mono',
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
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>
              <AnalyticsProvider>
                <AdProvider>
                  {children}
                  <AdRenderer />
                  <ChatWidget />
                  <Toaster richColors position="top-right" closeButton />
                </AdProvider>
              </AnalyticsProvider>
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
