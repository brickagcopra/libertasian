import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RolesGuard } from './roles.guard';

function createMockContext(user?: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  describe('no roles metadata', () => {
    it('should allow when no roles are required (undefined)', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const context = createMockContext({ role: 'member' });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow when roles array is empty', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
      const context = createMockContext({ role: 'member' });
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('role matching', () => {
    it('should allow when user role matches required role', () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(['admin', 'owner']);
      const context = createMockContext({ role: 'admin' });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow owner when owner is in the required list', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['owner']);
      const context = createMockContext({ role: 'owner' });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should throw when user role does not match any required role', () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(['admin', 'owner']);
      const context = createMockContext({ role: 'member' });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should throw when user role is viewer but editor is required', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['editor']);
      const context = createMockContext({ role: 'viewer' });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should throw for student role when only admin/owner are allowed', () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(['admin', 'owner']);
      const context = createMockContext({ role: 'student' });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('missing user or role', () => {
    it('should throw when no user is attached to request', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
      const context = createMockContext(undefined);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should throw when user has no role property', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
      const context = createMockContext({ sub: 'user-123' });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should throw when user role is empty string', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
      const context = createMockContext({ role: '' });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should throw when user role is null', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
      const context = createMockContext({ role: null });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('all valid roles', () => {
    const allRoles = [
      'owner',
      'admin',
      'editor',
      'member',
      'reviewer',
      'student',
    ];

    allRoles.forEach((role) => {
      it(`should allow '${role}' when it is in the required roles list`, () => {
        jest
          .spyOn(reflector, 'getAllAndOverride')
          .mockReturnValue(allRoles);
        const context = createMockContext({ role });
        expect(guard.canActivate(context)).toBe(true);
      });
    });
  });

  describe('error message', () => {
    it('should include descriptive error message', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
      const context = createMockContext({ role: 'member' });
      try {
        guard.canActivate(context);
        fail('Expected ForbiddenException');
      } catch (err) {
        expect((err as ForbiddenException).message).toBe(
          'Insufficient role permissions',
        );
      }
    });
  });
});
