import { Test, TestingModule } from '@nestjs/testing';

import { AuditService } from '../../modules/audit/audit.service';
import { AdminBypassAuditService } from './admin-bypass-audit.service';

describe('AdminBypassAuditService', () => {
  let service: AdminBypassAuditService;
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AdminBypassAuditService,
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(AdminBypassAuditService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function flush(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  it('writes an audit row with action=admin_subscription_bypass', async () => {
    service.record({
      userId: 'admin-1',
      organizationId: 'org-1',
      route: 'GET /documents/:id',
      documentId: 'doc-9',
    });

    await flush();

    expect(audit.log).toHaveBeenCalledWith({
      organizationId: 'org-1',
      actorUserId: 'admin-1',
      actorType: 'admin',
      action: 'admin_subscription_bypass',
      entityType: 'request',
      metadata: { route: 'GET /documents/:id', documentId: 'doc-9' },
    });
  });

  it('throttles duplicate (userId, route) hits within the 60s window', async () => {
    const t0 = new Date('2026-05-20T00:00:00Z').getTime();
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);

    service.record({ userId: 'admin-1', route: 'GET /documents' });
    dateSpy.mockReturnValue(t0 + 1000);
    service.record({ userId: 'admin-1', route: 'GET /documents' });
    dateSpy.mockReturnValue(t0 + 59_000);
    service.record({ userId: 'admin-1', route: 'GET /documents' });

    await flush();

    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('admits a second log entry after the throttle window elapses', async () => {
    const t0 = new Date('2026-05-20T00:00:00Z').getTime();
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);

    service.record({ userId: 'admin-1', route: 'GET /documents' });
    await flush();

    dateSpy.mockReturnValue(t0 + 90_000); // +90s, past the 60s window

    service.record({ userId: 'admin-1', route: 'GET /documents' });
    await flush();

    expect(audit.log).toHaveBeenCalledTimes(2);
  });

  it('does not throttle distinct (userId, route) pairs against each other', async () => {
    const t0 = new Date('2026-05-20T00:00:00Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(t0);

    service.record({ userId: 'admin-1', route: 'GET /documents' });
    service.record({ userId: 'admin-1', route: 'GET /digests' });
    service.record({ userId: 'admin-2', route: 'GET /documents' });

    await flush();

    expect(audit.log).toHaveBeenCalledTimes(3);
  });

  it('swallows audit failures so the request flow is never broken', async () => {
    audit.log.mockRejectedValueOnce(new Error('db down'));

    expect(() =>
      service.record({ userId: 'admin-1', route: 'GET /documents' }),
    ).not.toThrow();
  });
});
