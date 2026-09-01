import { Body, Controller, Get, Header, Patch, UseGuards } from '@nestjs/common';
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

  /**
   * `Cache-Control: no-store` + `Vary: X-Platform`.
   *
   * The body varies by `x-platform` but the response only ever carried
   * `Vary: Origin`, so any shared cache — and the RN fetch layer's own — is
   * free to hand one platform's answer to another, or one ACCOUNT's answer to
   * the next one signed in on the same device. Added per route rather than as
   * a global interceptor: `site-content.controller.ts` and
   * `feed.controller.ts` set their own `Cache-Control` deliberately, and a
   * blanket rule would clobber them.
   *
   * `Origin` is repeated in the value on purpose. `@Header` SETS the header,
   * and `enableCors` already put `Vary: Origin` there; naming only
   * `X-Platform` would silently drop it.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  @Header('Vary', 'Origin, X-Platform')
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
        // Resolved per-request by JwtStrategy from effective permissions
        // (any `admin:*`). Frontend uses this as the trust signal that
        // gates the paywall UI — fail-closed if absent.
        isPlatformAdmin: payload.isPlatformAdmin ?? false,
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
