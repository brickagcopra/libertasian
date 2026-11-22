import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import type { SessionConcurrencyService } from '../../modules/auth/session-concurrency/session-concurrency.service';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard — concurrent-use check', () => {
  const user = { sub: 'u1', sid: 's1', organizationId: 'o1' };
  let concurrency: { isEnabled: jest.Mock; assertActive: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };
  let parentCanActivate: jest.SpyInstance;

  const context = (type = 'http'): ExecutionContext =>
    ({
      getType: () => type,
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const guard = () =>
    new JwtAuthGuard(
      concurrency as unknown as SessionConcurrencyService,
      reflector as unknown as Reflector,
    );

  beforeEach(() => {
    concurrency = {
      isEnabled: jest.fn().mockReturnValue(true),
      assertActive: jest.fn().mockResolvedValue(undefined),
    };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    parentCanActivate = jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockResolvedValue(true);
  });

  afterEach(() => parentCanActivate.mockRestore());

  it('touches the session after authentication', async () => {
    await expect(guard().canActivate(context())).resolves.toBe(true);
    expect(concurrency.assertActive).toHaveBeenCalledWith(user);
  });

  it('propagates 409 session_displaced', async () => {
    concurrency.assertActive.mockRejectedValue(new HttpException('displaced', 409));
    await expect(guard().canActivate(context())).rejects.toMatchObject({ status: 409 });
  });

  it('skips the check on @AllowDisplacedSession routes', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard().canActivate(context())).resolves.toBe(true);
    expect(concurrency.assertActive).not.toHaveBeenCalled();
  });

  it('skips the check when the feature is disabled', async () => {
    concurrency.isEnabled.mockReturnValue(false);
    await guard().canActivate(context());
    expect(concurrency.assertActive).not.toHaveBeenCalled();
  });

  it('skips the check for non-http contexts', async () => {
    await guard().canActivate(context('ws'));
    expect(concurrency.assertActive).not.toHaveBeenCalled();
  });

  it('works without the service (unit tests constructing the guard bare)', async () => {
    await expect(new JwtAuthGuard().canActivate(context())).resolves.toBe(true);
  });
});
