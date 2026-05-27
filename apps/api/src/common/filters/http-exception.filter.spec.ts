import {
  ArgumentsHost,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

import { HttpExceptionFilter } from './http-exception.filter';
import { PaywallException } from '../exceptions/paywall.exception';

interface CapturedResponse {
  status: number;
  body: Record<string, unknown>;
}

const makeHost = (url = '/test/path'): { host: ArgumentsHost; captured: CapturedResponse } => {
  const captured: CapturedResponse = { status: 0, body: {} };
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      captured.body = payload;
      return this;
    },
  };
  const request = { url };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, captured };
};

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it('preserves custom fields from PaywallException (402)', () => {
    const { host, captured } = makeHost('/api/documents/abc');
    const exception = new PaywallException({
      corpus: 'documents',
      previewItemId: 'doc-123',
    });

    filter.catch(exception, host);

    expect(captured.status).toBe(HttpStatus.PAYMENT_REQUIRED);
    expect(captured.body['code']).toBe('subscription_required');
    expect(captured.body['corpus']).toBe('documents');
    expect(captured.body['previewItemId']).toBe('doc-123');
    expect(captured.body['statusCode']).toBe(402);
    expect(captured.body['error']).toBe('PAYMENT_REQUIRED');
    expect(captured.body['path']).toBe('/api/documents/abc');
    expect(typeof captured.body['timestamp']).toBe('string');
  });

  it('preserves quota object from a search-quota 403 exception', () => {
    const { host, captured } = makeHost('/api/search');
    // Mirror what the search-quota guard throws: an HttpException whose
    // response object carries a `quota` field alongside the canonical ones.
    const { HttpException } = jest.requireActual('@nestjs/common') as typeof import('@nestjs/common');
    const exception = new HttpException(
      {
        message: 'Daily search quota exhausted',
        quota: { used: 50, limit: 50, resetsAt: '2026-05-27T00:00:00.000Z' },
      },
      HttpStatus.FORBIDDEN,
    );

    filter.catch(exception, host);

    expect(captured.status).toBe(HttpStatus.FORBIDDEN);
    expect(captured.body['quota']).toEqual({
      used: 50,
      limit: 50,
      resetsAt: '2026-05-27T00:00:00.000Z',
    });
    expect(captured.body['statusCode']).toBe(403);
    expect(captured.body['error']).toBe('FORBIDDEN');
  });

  it('produces canonical-only body for a plain NotFoundException', () => {
    const { host, captured } = makeHost('/api/missing');

    filter.catch(new NotFoundException(), host);

    expect(captured.status).toBe(HttpStatus.NOT_FOUND);
    // No extra keys beyond the canonical envelope.
    expect(Object.keys(captured.body).sort()).toEqual(
      ['statusCode', 'message', 'error', 'timestamp', 'path'].sort(),
    );
    expect(captured.body['statusCode']).toBe(404);
    expect(captured.body['error']).toBe('NOT_FOUND');
    expect(captured.body['path']).toBe('/api/missing');
  });

  it('returns 500 with generic message and no leaked fields for non-HttpException', () => {
    const { host, captured } = makeHost('/api/boom');

    filter.catch(new Error('boom'), host);

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body['statusCode']).toBe(500);
    expect(captured.body['message']).toBe('Internal server error');
    expect(captured.body['error']).toBe('INTERNAL_SERVER_ERROR');
    // No custom fields leaked from the Error instance.
    expect(Object.keys(captured.body).sort()).toEqual(
      ['statusCode', 'message', 'error', 'timestamp', 'path'].sort(),
    );
  });
});
