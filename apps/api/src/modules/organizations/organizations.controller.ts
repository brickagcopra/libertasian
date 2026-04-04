import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuditService } from '../audit/audit.service';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  InviteMemberDto,
  UpdateMemberRoleDto,
} from './dto';
import { OrganizationsService } from './organizations.service';

/**
 * Organizations controller — all endpoints require authentication.
 * Role-based authorization handled at service layer via assertRole() method.
 * MfaGuard not applied at class level: regular members can view their own org.
 * Owner/admin actions are protected by service-level role checks.
 */
@ApiTags('Organizations')
@Controller('organizations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new organization (firm/school)' })
  async create(
    @Body() dto: CreateOrganizationDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const org = await this.organizationsService.create(dto, user.sub);
    await this.auditService.log({
      organizationId: org.id,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'organization.create',
      entityType: 'organization',
      entityId: org.id,
      metadata: { name: dto.name, type: dto.type ?? 'firm', ip },
    });
    return { success: true, data: org };
  }

  @Get('me')
  @ApiOperation({ summary: 'List organizations the current user belongs to' })
  async listMyOrganizations(@CurrentUser() user: JwtPayload) {
    const orgs = await this.organizationsService.listUserOrganizations(user.sub);
    return { success: true, data: orgs };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get organization details' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    // Ensure user is a member (assertRole with any role)
    await this.organizationsService.assertRole(id, user.sub, [
      'owner', 'admin', 'editor', 'member', 'reviewer', 'student',
    ]);
    const org = await this.organizationsService.findById(id);
    return { success: true, data: org };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update organization details (owner/admin only)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const org = await this.organizationsService.update(id, dto, user.sub);
    await this.auditService.log({
      organizationId: id,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'organization.update',
      entityType: 'organization',
      entityId: id,
      metadata: { changes: dto, ip },
    });
    return { success: true, data: org };
  }

  // ---- Members ----

  @Get(':id/members')
  @ApiOperation({ summary: 'List organization members' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    await this.organizationsService.assertRole(id, user.sub, [
      'owner', 'admin', 'editor', 'member', 'reviewer', 'student',
    ]);
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 100) : 20;
    const result = await this.organizationsService.listMembers(id, cursor, parsedLimit);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get(':id/pending-invites')
  @ApiOperation({ summary: 'List pending invites for unregistered users (owner/admin only)' })
  async listPendingInvites(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const invites = await this.organizationsService.listPendingInvites(
      id,
      user.sub,
    );
    return { success: true, data: invites };
  }

  @Post(':id/members/invite')
  @ApiOperation({ summary: 'Invite a user to the organization (owner/admin only)' })
  async inviteMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InviteMemberDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const member = await this.organizationsService.inviteMember(id, dto, user.sub);
    await this.auditService.log({
      organizationId: id,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'organization.member_invited',
      entityType: 'organization_member',
      entityId: member.id,
      metadata: { role: dto.role, ip },
    });
    return { success: true, data: member };
  }

  @Patch(':id/members/:userId')
  @ApiOperation({ summary: 'Update member role (owner/admin only)' })
  async updateMemberRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const updated = await this.organizationsService.updateMemberRole(
      id,
      userId,
      dto.role,
      user.sub,
    );
    await this.auditService.log({
      organizationId: id,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'organization.member_role_updated',
      entityType: 'organization_member',
      entityId: updated.id,
      metadata: { newRole: dto.role, targetUserId: userId, ip },
    });
    return { success: true, data: updated };
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove a member from the organization (owner/admin only)' })
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.organizationsService.removeMember(id, userId, user.sub);
    await this.auditService.log({
      organizationId: id,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'organization.member_removed',
      entityType: 'organization_member',
      metadata: { targetUserId: userId, ip },
    });
    return { success: true, data: { message: 'Member removed' } };
  }
}
