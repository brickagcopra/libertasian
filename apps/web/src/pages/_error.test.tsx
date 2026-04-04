import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import ErrorPage from './_error';

describe('ErrorPage', () => {
  it('renders status code as heading', () => {
    render(<ErrorPage statusCode={500} />);
    expect(screen.getByText('500')).toBeInTheDocument();
  });

  it('shows "Page not found" for 404', () => {
    render(<ErrorPage statusCode={404} />);
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });

  it('shows generic error message for non-404 errors', () => {
    render(<ErrorPage statusCode={500} />);
    expect(screen.getByText('An error occurred')).toBeInTheDocument();
  });

  it('shows "Error" when statusCode is undefined', () => {
    render(<ErrorPage />);
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('An error occurred')).toBeInTheDocument();
  });

  it('has getInitialProps that extracts statusCode from response', () => {
    const result = ErrorPage.getInitialProps({
      res: { statusCode: 403 } as never,
      err: null as never,
    } as never);
    expect(result).toEqual({ statusCode: 403 });
  });

  it('has getInitialProps that falls back to err statusCode', () => {
    const result = ErrorPage.getInitialProps({
      res: null as never,
      err: { statusCode: 500 } as never,
    } as never);
    expect(result).toEqual({ statusCode: 500 });
  });

  it('has getInitialProps that defaults to 404', () => {
    const result = ErrorPage.getInitialProps({
      res: null as never,
      err: null as never,
    } as never);
    expect(result).toEqual({ statusCode: 404 });
  });
});
