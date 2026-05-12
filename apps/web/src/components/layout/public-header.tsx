'use client';

import Link from 'next/link';

import { Logo } from '@/components/brand/logo';

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/">
          <Logo width={200} height={44} />
        </Link>
        <nav className="hidden items-center gap-6 sm:flex">
          <Link
            href="/#features"
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            Features
          </Link>
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
  );
}
