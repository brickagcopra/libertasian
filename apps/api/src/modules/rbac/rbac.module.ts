import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { AuditModule } from '../audit/audit.module';
import { PermissionsController } from './controllers/permissions.controller';
import { RolesController } from './controllers/roles.controller';
import { MemberRolesController } from './controllers/member-roles.controller';
import { RbacAuditController } from './controllers/rbac-audit.controller';
import { PlatformStaffController } from './controllers/platform-staff.controller';
import { PlatformRolesController } from './controllers/platform-roles.controller';
import { SelfPermissionsController } from './controllers/self-permissions.controller';
import { PermissionsService } from './permissions.service';
import { RbacCacheService } from './rbac-cache.service';
import { RolesService } from './roles.service';
import { PlatformGrantsService } from './platform-grants.service';
import { PlatformRosterHealthService } from './platform-roster.health';

/**
 * Global RBAC module — provides permission resolution, role management,
 * and caching services to all other modules.
 *
 * Since PrismaModule and RedisModule are already @Global(),
 * they are available without explicit import.
 */
@Global()
@Module({
  imports: [AuditModule, DiscoveryModule],
  controllers: [
    PermissionsController,
    RolesController,
    MemberRolesController,
    RbacAuditController,
    SelfPermissionsController,
    PlatformStaffController,
    PlatformRolesController,
  ],
  providers: [
    RbacCacheService,
    PermissionsService,
    RolesService,
    PlatformGrantsService,
    PlatformRosterHealthService,
  ],
  exports: [
    RbacCacheService,
    PermissionsService,
    RolesService,
    PlatformGrantsService,
    PlatformRosterHealthService,
  ],
})
export class RbacModule {}
