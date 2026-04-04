import { ExecutionContext, ForbiddenException } from '@nestjs/common';

import { TenantGuard } from './tenant.guard';

function createMockContext(user?: Record<string, unknown>): {
  context: ExecutionContext;
  request: Record<string, unknown>;
} {
  const request: Record<string, unknown> = { user };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('TenantGuard', () => {
  let guard: TenantGuard;

  beforeEach(() => {
    guard = new TenantGuard();
  });

  describe('canActivate', () => {
    it('should allow when user has organizationId and attach tenantContext', () => {
      const { context, request } = createMockContext({
        sub: 'user-123',
        organizationId: 'org-456',
      });
      expect(guard.canActivate(context)).toBe(true);
      expect(request['tenantContext']).toEqual({
        organizationId: 'org-456',
      });
    });

    it('should throw ForbiddenException when user has no organizationId', () => {
      const { context } = createMockContext({ sub: 'user-123' });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when user is undefined', () => {
      const { context } = createMockContext(undefined);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when organizationId is empty string', () => {
      const { context } = createMockContext({
        sub: 'user-123',
        organizationId: '',
      });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when organizationId is null', () => {
      const { context } = createMockContext({
        sub: 'user-123',
        organizationId: null,
      });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should include helpful error message', () => {
      const { context } = createMockContext({});
      try {
        guard.canActivate(context);
        fail('Expected ForbiddenException');
      } catch (err) {
        expect((err as ForbiddenException).message).toBe(
          'No organization context',
        );
      }
    });

    it('should preserve existing request properties when attaching tenantContext', () => {
      const { context, request } = createMockContext({
        sub: 'user-123',
        organizationId: 'org-789',
      });
      request['someExisting'] = 'value';
      guard.canActivate(context);
      expect(request['someExisting']).toBe('value');
      expect(request['tenantContext']).toEqual({
        organizationId: 'org-789',
      });
    });

    it('should overwrite previous tenantContext if called again', () => {
      const { context, request } = createMockContext({
        sub: 'user-123',
        organizationId: 'org-new',
      });
      request['tenantContext'] = { organizationId: 'org-old' };
      guard.canActivate(context);
      expect(request['tenantContext']).toEqual({
        organizationId: 'org-new',
      });
    });
  });
});
