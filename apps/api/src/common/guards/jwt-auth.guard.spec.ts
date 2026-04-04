import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  const mockContext = {} as ExecutionContext;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  describe('handleRequest', () => {
    it('should return user when valid user is provided', () => {
      const user = { sub: 'user-123', email: 'test@example.com' };
      const result = guard.handleRequest(null, user, null, mockContext);
      expect(result).toEqual(user);
    });

    it('should throw UnauthorizedException when user is null', () => {
      expect(() => guard.handleRequest(null, null, null, mockContext)).toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when user is undefined', () => {
      expect(() =>
        guard.handleRequest(null, undefined, null, mockContext),
      ).toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user is false', () => {
      expect(() =>
        guard.handleRequest(null, false as unknown, null, mockContext),
      ).toThrow(UnauthorizedException);
    });

    it('should throw the original error when err is provided', () => {
      const error = new Error('Token expired');
      expect(() =>
        guard.handleRequest(error, null, null, mockContext),
      ).toThrow(error);
    });

    it('should throw original error even if user is provided', () => {
      const error = new Error('Invalid signature');
      const user = { sub: 'user-123' };
      expect(() =>
        guard.handleRequest(error, user, null, mockContext),
      ).toThrow(error);
    });

    it('should return user with all JWT fields', () => {
      const user = {
        sub: 'user-123',
        email: 'admin@example.com',
        role: 'admin',
        organizationId: 'org-456',
        mfaVerified: true,
      };
      const result = guard.handleRequest(null, user, null, mockContext);
      expect(result).toEqual(user);
      expect(result.sub).toBe('user-123');
      expect(result.role).toBe('admin');
    });

    it('should throw UnauthorizedException with correct message when no user', () => {
      try {
        guard.handleRequest(null, null, null, mockContext);
        fail('Expected error');
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        expect((err as UnauthorizedException).message).toBe(
          'Invalid or expired token',
        );
      }
    });
  });
});
