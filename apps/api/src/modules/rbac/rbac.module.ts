import { Global, Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PermissionsController } from './controllers/permissions.controller';
import { RolesController } from './controllers/roles.controller';
import { MemberRolesController } from './controllers/member-roles.controller';
import { RbacAuditController } from './controllers/rbac-audit.controller';
import { PermissionsService } from './permissions.service';
import { RbacCacheService } from './rbac-cache.service';
import { RolesService } from './roles.service';

/**
 * Global RBAC module — provides permission resolution, role management,
 * and caching services to all other modules.
 *
 * Since PrismaModule and RedisModule are already @Global(),
 * they are available without explicit import.
 */
@Global()
@Module({
  imports: [AuditModule],
  controllers: [
    PermissionsController,
    RolesController,
    MemberRolesController,
    RbacAuditController,
  ],
  providers: [RbacCacheService, PermissionsService, RolesService],
  exports: [RbacCacheService, PermissionsService, RolesService],
})
export class RbacModule {}
