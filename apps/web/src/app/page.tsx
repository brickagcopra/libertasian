import Link from 'next/link';

import { Logo } from '@/components/brand/logo';

// ---- Homepage Content Types ----

interface HomepageContent {
  hero: {
    tagline: string;
    headline: string;
    headlineAccent: string;
    description: string;
    primaryCta: { text: string; href: string };
    secondaryCta: { text: string; href: string };
    finePrint: string;
  };
  features: {
    sectionTitle: string;
    sectionSubtitle: string;
    items: Array<{ title: string; description: string; icon: string }>;
  };
  differentiators: {
    sectionTitle: string;
    sectionSubtitle: string;
    items: Array<{ capability: string; libertasian: boolean; others: string; note: string }>;
  };
  trust: {
    sectionTitle: string;
    sectionSubtitle: string;
    items: Array<{ title: string; description: string }>;
  };
  personas: {
    sectionTitle: string;
    sectionSubtitle: string;
    items: Array<{ title: string; plan: string; price: string; features: string[] }>;
  };
  cta: {
    headline: string;
    description: string;
    primaryCta: { text: string; href: string };
    secondaryCta: { text: string; href: string };
  };
  disclaimer: string;
  footer: {
    brandDescription: string;
    contactEmail: string;
    productLinks: Array<{ label: string; href: string }>;
    legalLinks: Array<{ label: string; href: string }>;
  };
}

// ---- Default Content (mirrors original hardcoded values) ----

const DEFAULT_HOMEPAGE_CONTENT: HomepageContent = {
  hero: {
    tagline: 'Philippine Legal AI Platform',
    headline: 'Legal research,',
    headlineAccent: 'reimagined.',
    description:
      'AI-powered search, case digest generation, camera scan-to-digest, bar review tools, and a full practice workspace. Built exclusively for Philippine law. Grounded in authoritative sources. Private by default.',
    primaryCta: { text: 'Get Started Free', href: '/auth/callback?mode=register' },
    secondaryCta: { text: 'View Plans', href: '/pricing' },
    finePrint: 'Free plan includes corpus access, 15 AI credits, and basic search. No credit card required.',
  },
  features: {
    sectionTitle: 'Everything you need for Philippine legal work',
    sectionSubtitle: 'From first-year law student to senior partner. One platform, every tool.',
    items: [
      {
        title: 'AI Legal Research',
        description:
          'Get AI-powered answers to legal questions with full source citations. Hybrid BM25 + semantic retrieval from 90,000+ Philippine legal documents.',
        icon: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z',
      },
      {
        title: 'Case Digest Generation',
        description:
          'Generate structured DFIR+ digests automatically — summary, facts, arguments, issues, ruling, doctrine, and dispositive with provenance mapping.',
        icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
      },
      {
        title: 'Camera Scan to Digest',
        description:
          'Scan printed legal documents with your phone. On-device edge detection, deskew, and enhancement. Server-side OCR generates searchable, citable digests.',
        icon: 'M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z M15 12.75a3 3 0 11-6 0 3 3 0 016 0z',
      },
      {
        title: 'Study & Bar Review',
        description:
          'Codal reader organized by bar subject, AI-generated flashcards with spaced repetition, reviewer packs, syllabus mode, and offline mobile reading.',
        icon: 'M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5',
      },
      {
        title: 'Practice Workspace',
        description:
          'Manage matters, draft legal memos, compare cases, generate pleadings, and collaborate with your team. Tasks, calendar, audit logs, and role-based access.',
        icon: 'M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0',
      },
      {
        title: 'Editorial Corpus',
        description:
          'Sourced from the Supreme Court E-Library, Lawphil, and Official Gazette. Automated ingestion, truthfulness validation, and editorial review queue.',
        icon: 'M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z',
      },
    ],
  },
  differentiators: {
    sectionTitle: 'Why LIBERTASIAN?',
    sectionSubtitle: 'No single competitor combines all these capabilities. We do.',
    items: [
      {
        capability: 'AI legal research & answers',
        libertasian: true,
        others: 'Partial',
        note: 'Only LIBERTASIAN combines all features in one platform',
      },
      {
        capability: 'Camera scan to digest',
        libertasian: true,
        others: 'None',
        note: 'No competitor offers mobile camera scan-to-digest',
      },
      {
        capability: 'Codal reader (by bar subject)',
        libertasian: true,
        others: 'eCodal+ only',
        note: 'Combined with AI search and flashcards',
      },
      {
        capability: 'Practice workspace (matters, tasks)',
        libertasian: true,
        others: 'None',
        note: 'No competitor offers matter management',
      },
      {
        capability: 'Flashcards & spaced repetition',
        libertasian: true,
        others: 'None',
        note: 'Auto-generated from digests with SM-2 algorithm',
      },
      {
        capability: 'Offline mobile reading',
        libertasian: true,
        others: 'eCodal+ only',
        note: 'Full codal + digest offline cache',
      },
      {
        capability: 'Team collaboration',
        libertasian: true,
        others: 'JurisChat V2',
        note: 'With audit logs, RBAC, and client-safe sharing',
      },
      {
        capability: 'Transparent truthfulness controls',
        libertasian: true,
        others: 'Internal only',
        note: 'Public confidence thresholds and review workflows',
      },
    ],
  },
  trust: {
    sectionTitle: 'Built on trust and truthfulness',
    sectionSubtitle: 'Legal AI demands accuracy. We take that seriously.',
    items: [
      {
        title: 'Zero Fabricated Citations',
        description:
          'Every AI-generated claim links to a verifiable source passage. If support is insufficient, the system abstains rather than hallucinate.',
      },
      {
        title: 'Official Sources First',
        description:
          'Authoritative government publications take precedence. Supreme Court E-Library, Lawphil, and Official Gazette are primary sources.',
      },
      {
        title: 'Private by Default',
        description:
          'Your camera scans, uploads, and notes never enter the public corpus without explicit permission and editorial rights review.',
      },
      {
        title: 'Full Provenance',
        description:
          'Every digest, summary, and AI output traces back to specific source sections. Source Excerpt, Grounded Summary, and Inferred Analysis are clearly labeled.',
      },
    ],
  },
  personas: {
    sectionTitle: 'For every legal professional',
    sectionSubtitle: 'Purpose-built for the Philippine legal ecosystem.',
    items: [
      {
        title: 'Bar Examinees & Students',
        plan: 'Edu',
        price: '499',
        features: [
          'Codal reader by bar subject',
          'AI flashcards with spaced repetition',
          'Reviewer packs & syllabus mode',
          'Offline mobile reading',
          'Study progress tracking',
        ],
      },
      {
        title: 'Solo Practitioners',
        plan: 'Pro',
        price: '999',
        features: [
          'Unlimited AI answers & digests',
          'Camera scan-to-digest',
          'Memo drafting assistance',
          'Case comparison & analysis',
          'Matter folders (20 active)',
        ],
      },
      {
        title: 'Small Firms',
        plan: 'Team',
        price: '799/seat',
        features: [
          'Team workspace & collaboration',
          'Shared digests & knowledge base',
          'Task management & calendar',
          'Role-based access control',
          'Audit logs & client-safe sharing',
        ],
      },
      {
        title: 'Enterprise & Editorial',
        plan: 'Enterprise',
        price: 'Custom',
        features: [
          'Official source ingestion tools',
          'Editorial review queue',
          'Publish to shared corpus',
          'Corpus health monitoring',
          'API access & custom integrations',
        ],
      },
    ],
  },
  cta: {
    headline: 'Start your legal research today',
    description:
      'Join thousands of Filipino legal professionals using AI-powered research. Free plan available. No credit card required.',
    primaryCta: { text: 'Create Free Account', href: '/auth/callback?mode=register' },
    secondaryCta: { text: 'Compare Plans', href: '/pricing' },
  },
  disclaimer:
    'LIBERTASIAN provides AI-powered legal research tools for informational purposes only. AI outputs are not legal advice and do not create an attorney-client relationship. Always consult a qualified Philippine lawyer for legal matters. The practice of law in the Philippines is reserved for members of the Philippine Bar.',
  footer: {
    brandDescription: 'Philippine Legal AI Platform. Democratizing access to legal knowledge.',
    contactEmail: 'support@libertasian.com',
    productLinks: [
      { label: 'Features', href: '#features' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Get Started', href: '/auth/callback?mode=register' },
    ],
    legalLinks: [
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Privacy Policy', href: '/privacy' },
    ],
  },
};

// ---- Deep Merge Utility ----

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T>(defaults: T, overrides: Partial<T>): T {
  const result = { ...defaults } as Record<string, unknown>;

  for (const key of Object.keys(overrides as Record<string, unknown>)) {
    const defaultVal = (defaults as Record<string, unknown>)[key];
    const overrideVal = (overrides as Record<string, unknown>)[key];

    if (isPlainObject(defaultVal) && isPlainObject(overrideVal)) {
      result[key] = deepMerge(defaultVal, overrideVal);
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal;
    }
  }

  return result as T;
}

// ---- Server-side Content Fetch ----

async function getHomepageContent(): Promise<HomepageContent> {
  try {
    const apiUrl = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/api/v1';
    const res = await fetch(`${apiUrl}/site-content/homepage`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return DEFAULT_HOMEPAGE_CONTENT;
    const data = (await res.json()) as { success: boolean; data: { content: Partial<HomepageContent> } };
    if (!data.success || !data.data?.content) return DEFAULT_HOMEPAGE_CONTENT;
    return deepMerge(DEFAULT_HOMEPAGE_CONTENT, data.data.content);
  } catch {
    return DEFAULT_HOMEPAGE_CONTENT;
  }
}

// ---- Page Component ----

export default async function HomePage() {
  const content = await getHomepageContent();

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/">
            <Logo width={200} height={44} />
          </Link>
          <nav className="hidden items-center gap-6 sm:flex">
            <Link
              href="#features"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Features
            </Link>
            <Link
              href="/pricing"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Pricing
            </Link>
            <Link
              href="/auth/callback?mode=login"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Log in
            </Link>
            <Link
              href="/auth/callback?mode=register"
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-6 py-24 text-center lg:py-32">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-gray-500">
            {content.hero.tagline}
          </p>
          <h1 className="mt-4 text-5xl font-bold tracking-tight text-gray-900 sm:text-6xl lg:text-7xl">
            {content.hero.headline}{' '}
            <span className="bg-gradient-to-r from-gray-900 to-gray-500 bg-clip-text text-transparent">
              {content.hero.headlineAccent}
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600">
            {content.hero.description}
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href={content.hero.primaryCta.href}
              className="w-full rounded-md bg-gray-900 px-8 py-3.5 text-sm font-semibold text-white hover:bg-gray-800 sm:w-auto"
            >
              {content.hero.primaryCta.text}
            </Link>
            <Link
              href={content.hero.secondaryCta.href}
              className="w-full rounded-md border border-gray-300 px-8 py-3.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 sm:w-auto"
            >
              {content.hero.secondaryCta.text}
            </Link>
          </div>
          <p className="mt-4 text-xs text-gray-400">
            {content.hero.finePrint}
          </p>
        </div>
      </section>

      {/* Feature Highlights */}
      <section id="features" className="border-t border-gray-100 bg-gray-50 py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-900">
              {content.features.sectionTitle}
            </h2>
            <p className="mt-3 text-gray-500">
              {content.features.sectionSubtitle}
            </p>
          </div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {content.features.items.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-gray-200 bg-white p-6 transition hover:shadow-md"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-900">
                  <svg
                    className="h-5 w-5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d={feature.icon} />
                  </svg>
                </div>
                <h3 className="mt-4 text-base font-semibold text-gray-900">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Differentiator Table */}
      <section className="py-20">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-900">
              {content.differentiators.sectionTitle}
            </h2>
            <p className="mt-3 text-gray-500">
              {content.differentiators.sectionSubtitle}
            </p>
          </div>

          <div className="mt-12 overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">
                    Capability
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-900">
                    LIBERTASIAN
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-500">
                    Others
                  </th>
                </tr>
              </thead>
              <tbody>
                {content.differentiators.items.map((row, i) => (
                  <tr
                    key={row.capability}
                    className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}
                  >
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{row.capability}</p>
                      <p className="text-xs text-gray-400">{row.note}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <svg
                        className="mx-auto h-5 w-5 text-green-500"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-gray-400">
                      {row.others}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Trust & Safety */}
      <section className="border-t border-gray-100 bg-gray-50 py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-900">
              {content.trust.sectionTitle}
            </h2>
            <p className="mt-3 text-gray-500">
              {content.trust.sectionSubtitle}
            </p>
          </div>

          <div className="mt-14 grid gap-8 sm:grid-cols-2">
            {content.trust.items.map((item) => (
              <div key={item.title} className="flex gap-4">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-green-100">
                  <svg
                    className="h-4 w-4 text-green-600"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900">{item.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-gray-600">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Personas */}
      <section className="py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-900">
              {content.personas.sectionTitle}
            </h2>
            <p className="mt-3 text-gray-500">
              {content.personas.sectionSubtitle}
            </p>
          </div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {content.personas.items.map((persona) => (
              <PersonaCard
                key={persona.plan}
                title={persona.title}
                plan={persona.plan}
                price={persona.price}
                items={persona.features}
              />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-gray-100 bg-gray-900 py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold text-white">
            {content.cta.headline}
          </h2>
          <p className="mt-4 text-gray-400">
            {content.cta.description}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href={content.cta.primaryCta.href}
              className="w-full rounded-md bg-white px-8 py-3.5 text-sm font-semibold text-gray-900 hover:bg-gray-100 sm:w-auto"
            >
              {content.cta.primaryCta.text}
            </Link>
            <Link
              href={content.cta.secondaryCta.href}
              className="text-sm font-semibold text-gray-300 hover:text-white"
            >
              {content.cta.secondaryCta.text} &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* Legal Disclaimer */}
      <div className="border-t border-gray-200 bg-gray-50 px-6 py-4">
        <p className="mx-auto max-w-4xl text-center text-xs leading-relaxed text-gray-400">
          {content.disclaimer}
        </p>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">LIBERTASIAN</p>
              <p className="mt-2 text-sm text-gray-500">
                {content.footer.brandDescription}
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Product</p>
              <ul className="mt-3 space-y-2">
                {content.footer.productLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-gray-500 hover:text-gray-700">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Legal</p>
              <ul className="mt-3 space-y-2">
                {content.footer.legalLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-gray-500 hover:text-gray-700">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Contact</p>
              <ul className="mt-3 space-y-2">
                <li>
                  <span className="text-sm text-gray-500">{content.footer.contactEmail}</span>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-10 border-t border-gray-200 pt-6">
            <p className="text-center text-xs text-gray-400">
              &copy; {new Date().getFullYear()} LIBERTASIAN. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function PersonaCard({
  title,
  plan,
  price,
  items,
}: {
  title: string;
  plan: string;
  price: string;
  items: string[];
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{plan}</p>
      <h3 className="mt-2 text-lg font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500">
        {price === 'Custom' ? 'Custom pricing' : `From ${String.fromCharCode(8369)}${price}/mo`}
      </p>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-gray-600">
            <svg
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
