import Link from 'next/link';

import { PublicFooter } from '@/components/layout/public-footer';
import { PublicHeader } from '@/components/layout/public-header';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-white">
      <PublicHeader />

      <main className="flex flex-col items-center justify-center p-24">
        <h1 className="text-4xl font-bold">404</h1>
        <p className="mt-4 text-lg text-gray-600">Page not found</p>
        <Link href="/" className="mt-6 text-sm font-medium text-blue-600 hover:underline">
          Go home
        </Link>
      </main>

      <PublicFooter />
    </div>
  );
}
