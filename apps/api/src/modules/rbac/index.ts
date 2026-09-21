export { RbacModule } from './rbac.module';
export { PermissionsService } from './permissions.service';
export { RolesService } from './roles.service';
export { RbacCacheService } from './rbac-cache.service';
export { PlatformGrantsService } from './platform-grants.service';
export type {
  PlatformStaffUser,
  PlatformGrantRow,
} from './platform-grants.service';

// Controllers
export { PermissionsController } from './controllers/permissions.controller';
export { RolesController } from './controllers/roles.controller';
export { MemberRolesController } from './controllers/member-roles.controller';
export { RbacAuditController } from './controllers/rbac-audit.controller';
export { SelfPermissionsController } from './controllers/self-permissions.controller';
export { PlatformStaffController } from './controllers/platform-staff.controller';
export { PlatformRolesController } from './controllers/platform-roles.controller';

// DTOs
export {
  ListPermissionsQueryDto,
  ListRolesQueryDto,
  CreateCustomRoleDto,
  UpdateCustomRoleDto,
  AssignRoleDto,
  ListAuditLogsQueryDto,
  ListMembersQueryDto,
  GrantPlatformRoleDto,
  ListPlatformStaffQueryDto,
  SearchStaffCandidatesQueryDto,
  CreatePlatformRoleDto,
  UpdatePlatformRoleDto,
} from './dto';
