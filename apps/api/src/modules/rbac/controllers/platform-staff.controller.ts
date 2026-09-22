import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard, PlatformPermissionsGuard } from '../../../common/guards';
import { RequiredPlatformPermissions } from '../../../common/decorators/platform-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { PlatformGrantsService } from '../platform-grants.service';
import {
  GrantPlatformRoleDto,
  ListPlatformAuditQueryDto,
  ListPlatformStaffQueryDto,
  SearchStaffCandidatesQueryDto,
} from '../dto';

interface AuthUser {
  sub: string;
}

/**
 * Platform staff administration.
 *
 * Guard chain is JwtAuthGuard + PlatformPermissionsGuard ONLY — deliberately
 * no TenantGuard, PermissionsGuard or SubscriptionGuard. Staff belong to no
 * organization, so an org-scoped guard has nothing to resolve and a
 * subscription gate would make platform capability depend on the actor's
 * personal workspace plan.
 */
@ApiTags('Platform — Staff')
@Controller('platform/staff')
@UseGuards(JwtAuthGuard, PlatformPermissionsGuard)
@RequiredPlatformPermissions('platform-staff:manage')
@Throttle({ default: { ttl: 60000, limit: 100 } })
@ApiBearerAuth()
export class PlatformStaffController {
  constructor(private readonly platformGrants: PlatformGrantsService) {}

  @Get()
  @ApiOperation({ summary: 'List current platform staff grants' })
  async list(@Query() query: ListPlatformStaffQueryDto) {
    const result = await this.platformGrants.listGrants({
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    });
    return { success: true, data: result.items, meta: result.meta };
  }

  // Static route MUST precede :userId so "candidates" is not read as a user id.
  @Get('candidates')
  @ApiOperation({
    summary: 'Search EXISTING users to grant a platform role to',
    description:
      'Never creates a user and never sends an invitation. A person with no account signs up themselves first.',
  })
  async searchCandidates(@Query() query: SearchStaffCandidatesQueryDto) {
    const candidates = await this.platformGrants.searchCandidates(
      query.q,
      query.limit,
    );
    return { success: true, data: candidates };
  }

  // Static route MUST precede :userId.
  @Get('audit')
  @ApiOperation({
    summary: 'Grant, revoke and refusal history',
    description:
      'Served here rather than from /rbac/audit-logs, which is tenant-scoped, plan-gated and needs audit-logs:read — a permission platform staff may not hold. Includes refusals, so a blocked escalation attempt is visible.',
  })
  async auditTrail(@Query() query: ListPlatformAuditQueryDto) {
    const result = await this.platformGrants.listAuditTrail({
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    });
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get(':userId/roles')
  @ApiOperation({ summary: 'List one user’s platform grants' })
  async listForUser(@Param('userId', ParseUUIDPipe) userId: string) {
    const grants = await this.platformGrants.getGrantsForUser(userId);
    return { success: true, data: grants };
  }

  @Post(':userId/roles')
  @ApiOperation({
    summary: 'Grant a platform role to an existing user',
    description:
      'Refuses privilege escalation (403), separation-of-duties and cardinality violations (409), and org-scoped roles (400).',
  })
  async grant(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: GrantPlatformRoleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const grant = await this.platformGrants.grant(
      userId,
      dto.roleDefinitionId,
      actor.sub,
      dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    );
    return { success: true, data: grant };
  }

  @Delete(':userId/roles/:roleDefinitionId')
  @ApiOperation({
    summary: 'Revoke a platform role',
    description:
      'Refuses with 409 if it would leave nobody holding an admin:* platform permission.',
  })
  async revoke(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('roleDefinitionId', ParseUUIDPipe) roleDefinitionId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.platformGrants.revoke(userId, roleDefinitionId, actor.sub);
    return { success: true };
  }
}
