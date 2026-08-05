import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site-url';

/**
 * Next.js file-convention sitemap. None existed before.
 *
 * Only genuinely public routes belong here: every path listed must return 200
 * to an anonymous request. Anything under app/(dashboard)/ 307s to /login, so
 * listing it would advertise a page a crawler — or a payment gateway's KYC
 * checker — cannot actually read.
 */
const PUBLIC_ROUTES: Array<{ path: string; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number }> = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/pricing', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/about', changeFrequency: 'yearly', priority: 0.7 },
  { path: '/contact', changeFrequency: 'yearly', priority: 0.7 },
  { path: '/blog', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.4 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.4 },
  { path: '/refund-policy', changeFrequency: 'yearly', priority: 0.4 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
