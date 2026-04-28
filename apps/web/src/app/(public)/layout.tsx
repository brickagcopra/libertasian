import Link from 'next/link';

export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-xl font-bold text-gray-900">
            LIBERTASIAN
          </Link>

          <nav className="flex items-center gap-6">
            <Link
              href="/bar-exams"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Bar Exams
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

      <main>{children}</main>

      {/* Legal Disclaimer */}
      <div className="border-t border-gray-200 bg-gray-50 px-6 py-4">
        <p className="mx-auto max-w-4xl text-center text-xs leading-relaxed text-gray-400">
          LIBERTASIAN provides AI-powered legal research tools for informational purposes only.
          AI outputs are not legal advice and do not create an attorney-client relationship.
          Always consult a qualified Philippine lawyer for legal matters.
        </p>
      </div>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">LIBERTASIAN</p>
              <p className="mt-2 text-sm text-gray-500">
                Philippine Legal AI Platform. Democratizing access to legal knowledge.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Product</p>
              <ul className="mt-3 space-y-2">
                <li>
                  <Link href="/pricing" className="text-sm text-gray-500 hover:text-gray-700">
                    Pricing
                  </Link>
                </li>
                <li>
                  <Link
                    href="/auth/callback?mode=register"
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Get Started
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Legal</p>
              <ul className="mt-3 space-y-2">
                <li>
                  <Link href="/terms" className="text-sm text-gray-500 hover:text-gray-700">
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="text-sm text-gray-500 hover:text-gray-700">
                    Privacy Policy
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Contact</p>
              <ul className="mt-3 space-y-2">
                <li>
                  <span className="text-sm text-gray-500">support@libertasian.com</span>
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
