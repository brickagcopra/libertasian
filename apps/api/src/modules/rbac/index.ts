export { RbacModule } from './rbac.module';
export { PermissionsService } from './permissions.service';
export { RolesService } from './roles.service';
export { RbacCacheService } from './rbac-cache.service';

// Controllers
export { PermissionsController } from './controllers/permissions.controller';
export { RolesController } from './controllers/roles.controller';
export { MemberRolesController } from './controllers/member-roles.controller';
export { RbacAuditController } from './controllers/rbac-audit.controller';

// DTOs
export {
  ListPermissionsQueryDto,
  ListRolesQueryDto,
  CreateCustomRoleDto,
  UpdateCustomRoleDto,
  AssignRoleDto,
  ListAuditLogsQueryDto,
  ListMembersQueryDto,
} from './dto';
