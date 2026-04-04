import type { NextPageContext } from 'next';

/**
 * Custom _error page override.
 * Works alongside app/not-found.tsx. This pages-dir error page is needed
 * for the legacy /404 static generation step. Prevents OneDrive casing
 * duplicate module error during build.
 */
function ErrorPage({ statusCode }: { statusCode?: number }) {
  return (
    <main style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 'bold' }}>{statusCode ?? 'Error'}</h1>
      <p style={{ marginTop: '1rem', color: '#6b7280' }}>
        {statusCode === 404 ? 'Page not found' : 'An error occurred'}
      </p>
    </main>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default ErrorPage;
