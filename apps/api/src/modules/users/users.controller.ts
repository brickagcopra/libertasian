import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuditService } from '../audit/audit.service';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

/**
 * Users controller — personal profile endpoints.
 * MfaGuard not needed: users manage their own profile regardless of role.
 */
@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async getMe(@CurrentUser() payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);
    return {
      success: true,
      data: {
        ...this.usersService.sanitize(user),
        organizationRole: payload.role,
        organizationId: payload.organizationId,
      },
    };
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user profile' })
  async updateMe(@CurrentUser() payload: JwtPayload, @Body() dto: UpdateUserDto) {
    const user = await this.usersService.update(payload.sub, dto);
    return { success: true, data: this.usersService.sanitize(user) };
  }

  @Patch('me/onboarding')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Complete user onboarding' })
  async completeOnboarding(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: CompleteOnboardingDto,
  ) {
    const user = await this.usersService.completeOnboarding(payload.sub, dto);

    await this.auditService.log({
      actorUserId: payload.sub,
      actorType: 'user',
      action: 'onboarding.complete',
      entityType: 'user',
      entityId: payload.sub,
      metadata: {
        userRole: dto.userRole,
        skipped: dto.skipped ?? false,
      },
    });

    return { success: true, data: this.usersService.sanitize(user) };
  }
}
