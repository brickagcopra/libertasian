import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Resolve the shared package to its SOURCE for tests. Its package `main`
      // points at `dist/index.js`, which is gitignored and only built during
      // the Docker/CI build — so a runtime (non-`import type`) import of it
      // resolves to undefined exports under a bare `vitest run`. The API's
      // jest config maps the same package the same way; this is the web twin.
      '@libertasian/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
