import {
  CallHandler,
  ExecutionContext,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, lastValueFrom, of } from 'rxjs';

import { AttachDisclaimerInterceptor } from './attach-disclaimer.interceptor';
import type { DisclaimerEnvelope } from '../../modules/content-disclaimers/content-disclaimers.service';

const ENVELOPE: DisclaimerEnvelope = {
  contentClass: 'ai_digest',
  version: 1,
  bodyHtml: '<p>AI-generated case digest — educational purposes only.</p>',
  bodyPlain: 'AI-generated case digest — educational purposes only.',
};

const MCQ_ENVELOPE: DisclaimerEnvelope = {
  contentClass: 'ai_mcq',
  version: 1,
  bodyHtml: '<p>AI-generated multiple-choice question.</p>',
  bodyPlain: 'AI-generated multiple-choice question.',
};

const makeContext = (type: 'http' | 'rpc' = 'http'): ExecutionContext => ({
  getType: () => type,
  getHandler: () => function handler() {},
  getClass: () => class Ctrl {},
  switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
  switchToRpc: () => ({}) as never,
  switchToWs: () => ({}) as never,
  getArgs: () => [],
  getArgByIndex: () => undefined,
  getArgs2: () => [],
} as unknown as ExecutionContext);

const makeHandler = (value: unknown): CallHandler => ({
  handle: () => of(value),
});

describe('AttachDisclaimerInterceptor', () => {
  let interceptor: AttachDisclaimerInterceptor;
  let reflector: Reflector;
  let disclaimers: { getEnvelope: jest.Mock };

  beforeEach(() => {
    reflector = new Reflector();
    disclaimers = {
      getEnvelope: jest.fn(async (contentClass: string) => {
        if (contentClass === 'ai_digest') return ENVELOPE;
        if (contentClass === 'ai_mcq') return MCQ_ENVELOPE;
        throw new NotFoundException(`no disclaimer for ${contentClass}`);
      }),
    };
    interceptor = new AttachDisclaimerInterceptor(
      reflector,
      disclaimers as never,
    );
  });

  describe('decorator-based detection', () => {
    it('attaches the correct disclaimer to an object response', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue('ai_digest');

      const ctx = makeContext();
      const handler = makeHandler({ id: 'd1', contentJson: { facts: '...' } });
      const result = await firstValueFrom(interceptor.intercept(ctx, handler));

      expect(result).toEqual({
        id: 'd1',
        contentJson: { facts: '...' },
        disclaimer: ENVELOPE,
      });
      expect(disclaimers.getEnvelope).toHaveBeenCalledWith('ai_digest');
    });

    it('resolves the disclaimer class from the decorator, not from the shape', async () => {
      // Handler is decorated ai_mcq, but the shape accidentally carries
      // derivativeType: 'ai_digest'. Decorator wins.
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('ai_mcq');

      const ctx = makeContext();
      const handler = makeHandler({ derivativeType: 'ai_digest', stem: 'Q' });
      const result = (await firstValueFrom(
        interceptor.intercept(ctx, handler),
      )) as { disclaimer: DisclaimerEnvelope };

      expect(result.disclaimer.contentClass).toBe('ai_mcq');
    });

    it('wraps an array response in an envelope with the disclaimer at top level', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('ai_mcq');

      const ctx = makeContext();
      const items = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }];
      const handler = makeHandler(items);
      const result = await firstValueFrom(interceptor.intercept(ctx, handler));

      expect(result).toEqual({ items, disclaimer: MCQ_ENVELOPE });
    });

    it('still attaches the disclaimer to an abstention / empty-answer object', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('ai_digest');

      const ctx = makeContext();
      const handler = makeHandler({ abstained: true, reason: 'low confidence' });
      const result = (await firstValueFrom(
        interceptor.intercept(ctx, handler),
      )) as { disclaimer: DisclaimerEnvelope; abstained: boolean };

      expect(result.abstained).toBe(true);
      expect(result.disclaimer).toEqual(ENVELOPE);
    });

    it('fails closed with 500 when the decorated class is unknown', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue('not_a_real_class');
      // Silence the logger during the expected-error path.
      jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const ctx = makeContext();
      const handler = makeHandler({ id: 'x' });

      await expect(
        lastValueFrom(interceptor.intercept(ctx, handler)),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('shape-based detection', () => {
    beforeEach(() => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    });

    it('attaches based on derivativeType field on an object response', async () => {
      const ctx = makeContext();
      const handler = makeHandler({
        id: 'd1',
        derivativeType: 'ai_digest',
        contentJson: {},
      });
      const result = (await firstValueFrom(
        interceptor.intercept(ctx, handler),
      )) as { disclaimer: DisclaimerEnvelope };

      expect(result.disclaimer).toEqual(ENVELOPE);
    });

    it('attaches based on derivativeType field on the first item of an array', async () => {
      const ctx = makeContext();
      const handler = makeHandler([
        { id: 'q1', derivativeType: 'ai_mcq' },
        { id: 'q2', derivativeType: 'ai_mcq' },
      ]);
      const result = await firstValueFrom(interceptor.intercept(ctx, handler));

      expect(result).toEqual({
        items: [
          { id: 'q1', derivativeType: 'ai_mcq' },
          { id: 'q2', derivativeType: 'ai_mcq' },
        ],
        disclaimer: MCQ_ENVELOPE,
      });
    });
  });

  describe('pass-through behaviour', () => {
    beforeEach(() => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    });

    it('returns a plain object response unchanged when there is no derivative signal', async () => {
      const ctx = makeContext();
      const payload = { id: 'u1', email: 'a@b.com' };
      const handler = makeHandler(payload);
      const result = await firstValueFrom(interceptor.intercept(ctx, handler));

      expect(result).toEqual(payload);
      expect(disclaimers.getEnvelope).not.toHaveBeenCalled();
    });

    it('returns an array response unchanged when no item has derivativeType', async () => {
      const ctx = makeContext();
      const payload = [{ id: '1' }, { id: '2' }];
      const handler = makeHandler(payload);
      const result = await firstValueFrom(interceptor.intercept(ctx, handler));

      expect(result).toEqual(payload);
    });

    it('passes null responses through unchanged', async () => {
      const ctx = makeContext();
      const handler = makeHandler(null);
      const result = await firstValueFrom(interceptor.intercept(ctx, handler));

      expect(result).toBeNull();
      expect(disclaimers.getEnvelope).not.toHaveBeenCalled();
    });

    it('skips non-http execution contexts entirely', async () => {
      const ctx = makeContext('rpc');
      const handler = makeHandler({ derivativeType: 'ai_digest', id: 'x' });
      const result = await firstValueFrom(interceptor.intercept(ctx, handler));

      // Untouched — rpc bypass short-circuits before any lookup.
      expect(result).toEqual({ derivativeType: 'ai_digest', id: 'x' });
      expect(disclaimers.getEnvelope).not.toHaveBeenCalled();
    });
  });
});
