import bundleAnalyzer from '@next/bundle-analyzer';
import type { NextConfig } from 'next';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@libertasian/types'],
  // Type checking is done separately via `pnpm type-check` in CI.
  // This avoids React 18/19 @types/react conflicts in the pnpm monorepo
  // where mobile (React 18) and web (React 19) coexist.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Skip ESLint during builds — run separately via `pnpm lint`.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default withBundleAnalyzer(nextConfig);
