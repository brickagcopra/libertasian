import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { InternalApiGuard } from './internal-api.guard';

function createMockContext(
  headers: Record<string, string | undefined>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('InternalApiGuard', () => {
  let guard: InternalApiGuard;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    guard = new InternalApiGuard(configService);
  });

  describe('missing header', () => {
    it('should throw UnauthorizedException when header is missing', () => {
      configService.get.mockReturnValue('valid-key');
      const context = createMockContext({});
      expect(() => guard.canActivate(context)).toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when header is undefined', () => {
      configService.get.mockReturnValue('valid-key');
      const context = createMockContext({
        'x-internal-api-key': undefined,
      });
      expect(() => guard.canActivate(context)).toThrow(
        UnauthorizedException,
      );
    });

    it('should include message about missing header', () => {
      configService.get.mockReturnValue('valid-key');
      const context = createMockContext({});
      try {
        guard.canActivate(context);
        fail('Expected UnauthorizedException');
      } catch (err) {
        expect((err as UnauthorizedException).message).toContain(
          'Missing X-Internal-Api-Key',
        );
      }
    });
  });

  describe('env var not configured', () => {
    it('should throw UnauthorizedException when INTERNAL_API_KEY env var is not set', () => {
      configService.get.mockReturnValue(undefined);
      const context = createMockContext({
        'x-internal-api-key': 'some-key',
      });
      expect(() => guard.canActivate(context)).toThrow(
        UnauthorizedException,
      );
    });

    it('should include message about internal API not configured', () => {
      configService.get.mockReturnValue(undefined);
      const context = createMockContext({
        'x-internal-api-key': 'some-key',
      });
      try {
        guard.canActivate(context);
        fail('Expected UnauthorizedException');
      } catch (err) {
        expect((err as UnauthorizedException).message).toContain(
          'not configured',
        );
      }
    });
  });

  describe('key validation', () => {
    it('should allow when header key matches env key', () => {
      configService.get.mockReturnValue('my-secret-internal-key');
      const context = createMockContext({
        'x-internal-api-key': 'my-secret-internal-key',
      });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should throw when header key does not match env key', () => {
      configService.get.mockReturnValue('correct-key');
      const context = createMockContext({
        'x-internal-api-key': 'wrong-key',
      });
      expect(() => guard.canActivate(context)).toThrow(
        UnauthorizedException,
      );
    });

    it('should throw with invalid key message', () => {
      configService.get.mockReturnValue('correct-key');
      const context = createMockContext({
        'x-internal-api-key': 'wrong-key',
      });
      try {
        guard.canActivate(context);
        fail('Expected UnauthorizedException');
      } catch (err) {
        expect((err as UnauthorizedException).message).toContain(
          'Invalid internal API key',
        );
      }
    });

    it('should be case-sensitive', () => {
      configService.get.mockReturnValue('CaseSensitiveKey');
      const context = createMockContext({
        'x-internal-api-key': 'casesensitivekey',
      });
      expect(() => guard.canActivate(context)).toThrow(
        UnauthorizedException,
      );
    });

    it('should not trim whitespace from key', () => {
      configService.get.mockReturnValue('key-with-spaces');
      const context = createMockContext({
        'x-internal-api-key': ' key-with-spaces ',
      });
      expect(() => guard.canActivate(context)).toThrow(
        UnauthorizedException,
      );
    });
  });
});
