import * as fs from 'fs';
import * as path from 'path';

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { PermissionsMetadata } from '../decorators/permissions.decorator';
import { PermissionsService } from '../../modules/rbac/permissions.service';
import { PermissionsGuard } from './permissions.guard';

function createMockContext(user?: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;
  let permissionsService: jest.Mocked<PermissionsService>;

  beforeEach(() => {
    reflector = new Reflector();
    permissionsService = {
      resolveMemberId: jest.fn(),
      hasAnyPermission: jest.fn(),
      hasAllPermissions: jest.fn(),
      getEffectivePermissions: jest.fn(),
      hasPermission: jest.fn(),
      getAllPermissions: jest.fn(),
      getPermissionByCode: jest.fn(),
    } as unknown as jest.Mocked<PermissionsService>;

    guard = new PermissionsGuard(reflector, permissionsService);
  });

  // --------------------------------------------------------------------------
  // No permissions metadata
  // --------------------------------------------------------------------------

  describe('no permissions metadata', () => {
    it('should return true when no @RequiredPermissions metadata exists', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const context = createMockContext({ sub: 'user-1' });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('should return true when permissions array is empty', async () => {
      const meta: PermissionsMetadata = { permissions: [], mode: 'all' };
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(meta);
      const context = createMockContext({ sub: 'user-1' });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // No user on request
  // --------------------------------------------------------------------------

  describe('missing user', () => {
    it('should throw ForbiddenException when no user on request', async () => {
      const meta: PermissionsMetadata = { permissions: ['documents:read'], mode: 'all' };
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(meta);
      const context = createMockContext(undefined);
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('Authentication required');
    });
  });

  // --------------------------------------------------------------------------
  // API key path
  // --------------------------------------------------------------------------

  describe('API key path', () => {
    it('should pass when apiKeyPermissions contains required permission', async () => {
      const meta: PermissionsMetadata = { permissions: ['documents:read'], mode: 'all' };
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(meta);
      const context = createMockContext({
        isApiKey: true,
        apiKeyPermissions: ['documents:read', 'documents:create'],
      });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('should throw when apiKeyPermissions lacks required permission', async () => {
      const meta: PermissionsMetadata = { permissions: ['admin:dashboard'], mode: 'all' };
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(meta);
      const context = createMockContext({
        isApiKey: true,
        apiKeyPermissions: ['documents:read'],
      });
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('API key lacks required permissions');
    });
  });

  // --------------------------------------------------------------------------
  // User path — member resolution
  // --------------------------------------------------------------------------

  describe('user path — member resolution', () => {
    const baseMeta: PermissionsMetadata = { permissions: ['documents:read'], mode: 'all' };

    it('should throw when userId or organizationId is missing', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(baseMeta);
      const context = createMockContext({ sub: 'user-1' }); // no organizationId
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('Missing user or organization context');
    });

    it('should use existing memberId from request if present', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(baseMeta);
      permissionsService.hasAllPermissions.mockResolvedValue(true);

      const context = createMockContext({
        sub: 'user-1',
        organizationId: 'org-1',
        memberId: 'member-existing',
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      // Should NOT call resolveMemberId since memberId already exists
      expect(permissionsService.resolveMemberId).not.toHaveBeenCalled();
      expect(permissionsService.hasAllPermissions).toHaveBeenCalledWith('member-existing', ['documents:read']);
    });

    it('should resolve memberId via service if not on request', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(baseMeta);
      permissionsService.resolveMemberId.mockResolvedValue('member-resolved');
      permissionsService.hasAllPermissions.mockResolvedValue(true);

      const context = createMockContext({
        sub: 'user-1',
        organizationId: 'org-1',
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(permissionsService.resolveMemberId).toHaveBeenCalledWith('user-1', 'org-1');
    });

    it('should throw when memberId cannot be resolved (not org member)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(baseMeta);
      permissionsService.resolveMemberId.mockResolvedValue(null);

      const context = createMockContext({
        sub: 'user-1',
        organizationId: 'org-1',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('Not a member of this organization');
    });

    it('should attach resolved memberId to request object', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(baseMeta);
      permissionsService.resolveMemberId.mockResolvedValue('member-attached');
      permissionsService.hasAllPermissions.mockResolvedValue(true);

      const user: Record<string, unknown> = {
        sub: 'user-1',
        organizationId: 'org-1',
      };
      const context = createMockContext(user);

      await guard.canActivate(context);
      expect(user['memberId']).toBe('member-attached');
    });
  });

  // --------------------------------------------------------------------------
  // Permission mode: 'all'
  // --------------------------------------------------------------------------

  describe("mode 'all'", () => {
    it('should pass when user has all required permissions', async () => {
      const meta: PermissionsMetadata = {
        permissions: ['documents:read', 'documents:update'],
        mode: 'all',
      };
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(meta);
      permissionsService.hasAllPermissions.mockResolvedValue(true);

      const context = createMockContext({
        sub: 'user-1',
        organizationId: 'org-1',
        memberId: 'member-1',
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(permissionsService.hasAllPermissions).toHaveBeenCalledWith('member-1', [
        'documents:read',
        'documents:update',
      ]);
    });

    it('should throw when user lacks one required permission', async () => {
      const meta: PermissionsMetadata = {
        permissions: ['documents:read', 'documents:delete'],
        mode: 'all',
      };
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(meta);
      permissionsService.hasAllPermissions.mockResolvedValue(false);

      const context = createMockContext({
        sub: 'user-1',
        organizationId: 'org-1',
        memberId: 'member-1',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });

  // --------------------------------------------------------------------------
  // Permission mode: 'any'
  // --------------------------------------------------------------------------

  describe("mode 'any'", () => {
    it('should pass when user has at least one required permission', async () => {
      const meta: PermissionsMetadata = {
        permissions: ['admin:dashboard', 'admin:review-queue'],
        mode: 'any',
      };
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(meta);
      permissionsService.hasAnyPermission.mockResolvedValue(true);

      const context = createMockContext({
        sub: 'user-1',
        organizationId: 'org-1',
        memberId: 'member-1',
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(permissionsService.hasAnyPermission).toHaveBeenCalledWith('member-1', [
        'admin:dashboard',
        'admin:review-queue',
      ]);
    });

    it('should throw when user has none of the required permissions', async () => {
      const meta: PermissionsMetadata = {
        permissions: ['admin:dashboard', 'admin:review-queue'],
        mode: 'any',
      };
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(meta);
      permissionsService.hasAnyPermission.mockResolvedValue(false);

      const context = createMockContext({
        sub: 'user-1',
        organizationId: 'org-1',
        memberId: 'member-1',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });

  // --------------------------------------------------------------------------
  // Error messages
  // --------------------------------------------------------------------------

  describe('error message', () => {
    it('should include required permission codes in error message', async () => {
      const meta: PermissionsMetadata = {
        permissions: ['documents:create', 'documents:update'],
        mode: 'all',
      };
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(meta);
      permissionsService.hasAllPermissions.mockResolvedValue(false);

      const context = createMockContext({
        sub: 'user-1',
        organizationId: 'org-1',
        memberId: 'member-1',
      });

      try {
        await guard.canActivate(context);
        fail('Expected ForbiddenException');
      } catch (err) {
        const message = (err as ForbiddenException).message;
        expect(message).toContain('documents:create');
        expect(message).toContain('documents:update');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Static check: every @RequiredPermissions code must exist in the RBAC seed
// ---------------------------------------------------------------------------

describe('RBAC seed coverage', () => {
  /** Parse permission codes from the seed file (avoids importing outside rootDir) */
  function parseSeededCodes(): Set<string> {
    const seedPath = path.resolve(__dirname, '../../../prisma/seeds/rbac-seed.ts');
    const content = fs.readFileSync(seedPath, 'utf-8');
    const codes = new Set<string>();
    // Match `code: 'some:code'` entries in the PERMISSIONS array
    const codePattern = /code:\s*'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = codePattern.exec(content)) !== null) {
      if (m[1]) codes.add(m[1]);
    }
    return codes;
  }

  /** Recursively collect .ts source files (excluding tests) */
  function collectSourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        files.push(...collectSourceFiles(fullPath));
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.endsWith('.test.ts')
      ) {
        files.push(fullPath);
      }
    }
    return files;
  }

  /** Extract permission codes from @RequiredPermissions(...) in source files */
  function extractUsedCodes(files: string[]): Set<string> {
    const codes = new Set<string>();
    const decoratorPattern = /@RequiredPermissions\(([\s\S]*?)\)/g;
    const stringPattern = /'([^']+)'|"([^"]+)"/g;

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      let decoratorMatch: RegExpExecArray | null;
      while ((decoratorMatch = decoratorPattern.exec(content)) !== null) {
        const args = decoratorMatch[1] ?? '';
        let strMatch: RegExpExecArray | null;
        while ((strMatch = stringPattern.exec(args)) !== null) {
          const code: string | undefined = strMatch[1] ?? strMatch[2];
          // Skip mode strings ('any', 'all') and non-permission values
          if (code !== undefined && code !== 'any' && code !== 'all' && code.includes(':')) {
            codes.add(code);
          }
        }
      }
    }
    return codes;
  }

  it('should have every @RequiredPermissions code present in the seed PERMISSIONS array', () => {
    const seededCodes = parseSeededCodes();
    expect(seededCodes.size).toBeGreaterThan(0);

    const srcDir = path.resolve(__dirname, '../..');
    const sourceFiles = collectSourceFiles(srcDir);
    const usedCodes = extractUsedCodes(sourceFiles);
    expect(usedCodes.size).toBeGreaterThan(0);

    const missing = [...usedCodes].filter((code) => !seededCodes.has(code)).sort();

    if (missing.length > 0) {
      fail(
        `The following @RequiredPermissions codes are used in controllers but missing from the RBAC seed:\n` +
          missing.map((c) => `  - ${c}`).join('\n'),
      );
    }
  });
});
