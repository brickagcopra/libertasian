import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site-url';

/**
 * Next.js file-convention robots.txt. None existed before, so crawlers had no
 * signal at all — including the ones a payment gateway uses to verify that the
 * business-identity pages are publicly reachable.
 *
 * Everything under the auth wall is disallowed: those routes 307 anonymous
 * visitors to /login, so crawling them yields nothing but redirect chains.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin/',
          '/settings/',
          '/search/',
          '/matters/',
          '/digests/',
          '/scans/',
          '/billing/',
          '/onboarding',
          '/login',
          '/register',
          '/forgot-password',
          '/reset-password',
          '/verify-email',
          '/auth/',
          '/restore-account',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
