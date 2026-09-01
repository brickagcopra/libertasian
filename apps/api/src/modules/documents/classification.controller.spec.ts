import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';

import { ClassificationController } from './classification.controller';
import type { ClassificationService } from './classification.service';
import type { AuditService } from '../audit/audit.service';
import {
  PERMISSIONS_KEY,
  type PermissionsMetadata,
} from '../../common/decorators/permissions.decorator';

/**
 * `GET /admin/classification/:id` did not exist.
 *
 * `app/admin/classification/index.tsx` pushes `/admin/classification/${item.id}`
 * on row tap and the detail screen renders from that response, but the
 * controller only ever declared review-queue / stats / confirm / reject /
 * override — so the screen 404'd on every open. Nothing failed loudly: the
 * mobile hook just never resolved, and the screen sat on its spinner.
 *
 * These tests assert the route table itself rather than a response body,
 * because the defect was an absent route, not a wrong one.
 */

type RouteInfo = { handler: string; method: RequestMethod; path: string };

function routesOf(controller: object): RouteInfo[] {
  const proto = Object.getPrototypeOf(controller) as object;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const fn = (proto as Record<string, unknown>)[name];
      if (typeof fn !== 'function') return null;
      const path = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
      if (path === undefined) return null;
      return {
        handler: name,
        method: Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod,
        path,
      };
    })
    .filter((r): r is RouteInfo => r !== null);
}

describe('ClassificationController route table', () => {
  const controller = new ClassificationController(
    {} as unknown as ClassificationService,
    {} as unknown as AuditService,
  );

  it('is mounted under admin/classification', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ClassificationController)).toBe(
      'admin/classification',
    );
  });

  it('declares GET :id — the route the detail screen calls', () => {
    const routes = routesOf(controller);
    const detail = routes.find(
      (r) => r.path === ':id' && r.method === RequestMethod.GET,
    );
    // Before the fix there was no such route and this was `undefined`.
    expect(detail).toBeDefined();
    expect(detail?.handler).toBe('getDetail');
  });

  it('declares GET :id AFTER the literal GET routes', () => {
    // Nest matches in declaration order, so a `:id` declared above
    // `review-queue` would swallow both sibling GETs and break the two screens
    // that currently work. Ordering is part of the fix, not incidental.
    const gets = routesOf(controller)
      .filter((r) => r.method === RequestMethod.GET)
      .map((r) => r.path);

    expect(gets).toContain('review-queue');
    expect(gets).toContain('stats');
    expect(gets.indexOf(':id')).toBeGreaterThan(gets.indexOf('review-queue'));
    expect(gets.indexOf(':id')).toBeGreaterThan(gets.indexOf('stats'));
  });

  it('inherits the same guards and permission as its siblings', () => {
    // The detail route adds no method-level guards: the class-level
    // JwtAuthGuard + MfaGuard + TenantGuard + PermissionsGuard and
    // @RequiredPermissions('admin:documents') already cover it, which is what
    // "guarded like its siblings" has to mean for this controller.
    const guards = Reflect.getMetadata('__guards__', ClassificationController);
    expect(guards).toBeDefined();
    expect(guards).toHaveLength(4);

    const perms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      ClassificationController,
    ) as PermissionsMetadata | undefined;
    expect(perms?.permissions).toEqual(['admin:documents']);

    const proto = Object.getPrototypeOf(controller) as Record<string, unknown>;
    expect(
      Reflect.getMetadata('__guards__', proto['getDetail'] as object),
    ).toBeUndefined();
  });
});

describe('ClassificationController.getDetail', () => {
  it('wraps the service result in the bare { success, data } envelope', async () => {
    const detail = { id: 'doc-1', documentTitle: 'People v. Cruz' };
    const service = {
      getClassificationDetail: jest.fn().mockResolvedValue(detail),
    };
    const controller = new ClassificationController(
      service as unknown as ClassificationService,
      {} as unknown as AuditService,
    );

    const res = await controller.getDetail('doc-1');

    expect(service.getClassificationDetail).toHaveBeenCalledWith('doc-1');
    // No `meta` sibling — so the mobile `apiClient` strips this envelope and
    // the hook must NOT read `.data` again. Matches `use-admin-classification.ts`.
    expect(res).toEqual({ success: true, data: detail });
    expect(Object.keys(res).sort()).toEqual(['data', 'success']);
  });
});
