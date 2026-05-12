import Link from 'next/link';

import { getHomepageContent } from '@/features/homepage/server/homepage-content';

export async function PublicFooter() {
  const content = await getHomepageContent();

  return (
    <>
      {/* Legal Disclaimer */}
      <div className="border-t border-gray-200 bg-gray-50 px-6 py-4">
        <p className="mx-auto max-w-4xl text-center text-xs leading-relaxed text-gray-400">
          {content.disclaimer}
        </p>
      </div>

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
    </>
  );
}
