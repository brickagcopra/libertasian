import { Html, Head, Main, NextScript } from 'next/document';

/**
 * Custom _document override.
 * Prevents OneDrive path-casing duplicate module error during static generation
 * by loading _document from the project directory (consistent casing) instead of
 * Next.js internal modules (inconsistent OneDrive/onedrive casing on Windows).
 */
export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
