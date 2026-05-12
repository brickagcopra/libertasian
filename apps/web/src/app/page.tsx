import Link from 'next/link';

import { Logo } from '@/components/brand/logo';
import { getHomepageContent } from '@/features/homepage/server/homepage-content';

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
              href="/blog"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Blog
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
