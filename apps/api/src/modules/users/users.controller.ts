import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { UpdateEmailPreferencesDto } from './dto/update-email-preferences.dto';
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
    private readonly prisma: PrismaService,
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

  // ---- Email Preferences ----

  @Get('me/email-preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user email preferences' })
  async getEmailPreferences(@CurrentUser() payload: JwtPayload) {
    const prefs = await this.prisma.emailPreference.findUnique({
      where: { userId: payload.sub },
    });

    if (!prefs) {
      // Return defaults if no preference record exists
      return {
        success: true,
        data: {
          transactional: true,
          subscriptionUpdates: true,
          announcements: true,
          blogNotifications: true,
        },
      };
    }

    return {
      success: true,
      data: {
        transactional: prefs.transactional,
        subscriptionUpdates: prefs.subscriptionUpdates,
        announcements: prefs.announcements,
        blogNotifications: prefs.blogNotifications,
      },
    };
  }

  @Patch('me/email-preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update email preferences' })
  async updateEmailPreferences(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: UpdateEmailPreferencesDto,
  ) {
    const prefs = await this.prisma.emailPreference.upsert({
      where: { userId: payload.sub },
      update: {
        ...(dto.subscriptionUpdates !== undefined && { subscriptionUpdates: dto.subscriptionUpdates }),
        ...(dto.announcements !== undefined && { announcements: dto.announcements }),
        ...(dto.blogNotifications !== undefined && { blogNotifications: dto.blogNotifications }),
      },
      create: {
        userId: payload.sub,
        unsubscribeToken: require('crypto').randomBytes(32).toString('hex'),
        ...(dto.subscriptionUpdates !== undefined && { subscriptionUpdates: dto.subscriptionUpdates }),
        ...(dto.announcements !== undefined && { announcements: dto.announcements }),
        ...(dto.blogNotifications !== undefined && { blogNotifications: dto.blogNotifications }),
      },
    });

    return {
      success: true,
      data: {
        transactional: prefs.transactional,
        subscriptionUpdates: prefs.subscriptionUpdates,
        announcements: prefs.announcements,
        blogNotifications: prefs.blogNotifications,
      },
    };
  }
}
