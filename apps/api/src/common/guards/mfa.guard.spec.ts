import { ExecutionContext, ForbiddenException } from '@nestjs/common';

import { MfaGuard } from './mfa.guard';

function createMockContext(user?: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('MfaGuard', () => {
  let guard: MfaGuard;

  beforeEach(() => {
    guard = new MfaGuard();
  });

  describe('MFA-required roles', () => {
    const mfaRequiredRoles = ['owner', 'admin', 'editor', 'reviewer'];

    mfaRequiredRoles.forEach((role) => {
      it(`should throw ForbiddenException for role '${role}' without MFA verification`, () => {
        const context = createMockContext({
          role,
          mfaVerified: false,
        });
        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      });

      it(`should allow role '${role}' with MFA verified`, () => {
        const context = createMockContext({
          role,
          mfaVerified: true,
        });
        expect(guard.canActivate(context)).toBe(true);
      });
    });
  });

  describe('non-MFA-required roles', () => {
    const nonMfaRoles = ['member', 'viewer', 'student'];

    nonMfaRoles.forEach((role) => {
      it(`should allow role '${role}' without MFA verification`, () => {
        const context = createMockContext({
          role,
          mfaVerified: false,
        });
        expect(guard.canActivate(context)).toBe(true);
      });

      it(`should allow role '${role}' with MFA verified`, () => {
        const context = createMockContext({
          role,
          mfaVerified: true,
        });
        expect(guard.canActivate(context)).toBe(true);
      });
    });
  });

  describe('edge cases', () => {
    it('should pass through when no user is attached', () => {
      const context = createMockContext(undefined);
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should pass through when user has no role', () => {
      const context = createMockContext({ mfaVerified: false });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should pass through when user has unknown role', () => {
      const context = createMockContext({
        role: 'unknown_role',
        mfaVerified: false,
      });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should throw for owner with mfaVerified undefined', () => {
      const context = createMockContext({ role: 'owner' });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should include helpful error message', () => {
      const context = createMockContext({
        role: 'admin',
        mfaVerified: false,
      });
      try {
        guard.canActivate(context);
        fail('Expected ForbiddenException');
      } catch (err) {
        expect((err as ForbiddenException).message).toContain(
          'Multi-factor authentication is required',
        );
      }
    });
  });
});
