import type { Request } from 'express';
import type { JwtPayload } from '@libertasian/types';

import type { AdminBypassAuditService } from '../../common/services/admin-bypass-audit.service';
import type { AuditService } from '../audit/audit.service';
import type { EntitlementService } from '../subscriptions/entitlement.service';
import { DocumentsController } from './documents.controller';
import type { DocumentsService } from './documents.service';
import type { ListDocumentsQueryDto } from './dto';

function buildUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: 'user-1',
    email: 'u@example.com',
    role: 'member' as JwtPayload['role'],
    organizationId: 'org-free-1',
    mfaVerified: true,
    iat: 0,
    exp: 0,
    ...overrides,
  };
}

function buildReq(method = 'GET', path = '/documents/abc'): Request {
  return { method, path, route: { path } } as unknown as Request;
}

describe('DocumentsController — platform admin bypass', () => {
  let controller: DocumentsController;
  let documentsService: { list: jest.Mock; findById: jest.Mock };
  let entitlementService: { resolveEffectiveEntitlements: jest.Mock };
  let adminBypassAudit: { record: jest.Mock };

  beforeEach(() => {
    documentsService = {
      list: jest.fn().mockResolvedValue({ items: [], meta: {} }),
      findById: jest.fn().mockResolvedValue({ id: 'doc-1' }),
    };
    entitlementService = {
      // free-tier org: previewOnly is true
      resolveEffectiveEntitlements: jest.fn().mockResolvedValue({
        previewOnly: true,
      }),
    };
    adminBypassAudit = { record: jest.fn() };

    // Instantiate directly to avoid Nest's DI trying to resolve guards
    // (PermissionsGuard pulls PermissionsService, which we don't need for
    // controller-method unit tests of the read endpoints).
    controller = new DocumentsController(
      documentsService as unknown as DocumentsService,
      { log: jest.fn() } as unknown as AuditService,
      entitlementService as unknown as EntitlementService,
      adminBypassAudit as unknown as AdminBypassAuditService,
    );
  });

  it('platform admin on a free org sees FULL content (previewOnly forced false)', async () => {
    const admin = buildUser({ sub: 'admin-1', isPlatformAdmin: true });

    await controller.findById('doc-1', admin, buildReq('GET', '/documents/:id'));

    expect(documentsService.findById).toHaveBeenCalledWith('doc-1', false);
    expect(entitlementService.resolveEffectiveEntitlements).not.toHaveBeenCalled();
    expect(adminBypassAudit.record).toHaveBeenCalledWith({
      userId: 'admin-1',
      organizationId: 'org-free-1',
      route: 'GET /documents/:id',
      documentId: 'doc-1',
    });
  });

  it('non-admin user on a free org still gets PREVIEW gating', async () => {
    const user = buildUser({ isPlatformAdmin: false });

    await controller.findById('doc-1', user, buildReq());

    expect(documentsService.findById).toHaveBeenCalledWith('doc-1', true);
    expect(entitlementService.resolveEffectiveEntitlements).toHaveBeenCalledWith(
      'org-free-1',
    );
    expect(adminBypassAudit.record).not.toHaveBeenCalled();
  });

  it('anonymous caller (no JWT) is treated as free-tier and not flagged as bypass', async () => {
    await controller.findById('doc-1', null, buildReq());

    expect(documentsService.findById).toHaveBeenCalledWith('doc-1', true);
    expect(adminBypassAudit.record).not.toHaveBeenCalled();
  });

  it('admin bypass also applies to list endpoint', async () => {
    const admin = buildUser({ isPlatformAdmin: true });

    await controller.list({} as ListDocumentsQueryDto, admin, buildReq('GET', '/documents'));

    expect(documentsService.list).toHaveBeenCalledWith({}, false);
    expect(adminBypassAudit.record).toHaveBeenCalled();
  });
});
