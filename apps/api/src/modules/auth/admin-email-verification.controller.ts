import {
  BadRequestException,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';

/**
 * Staff controls for a user's email verification (admin → Users → detail).
 *
 * Lives in AuthModule rather than beside UsersAdminController because
 * issuing a code is AuthService's job and AuthModule already imports
 * UsersModule (the reverse import would be circular). Same route prefix,
 * same guard stack and permission as the rest of admin/users.
 */
@ApiTags('Admin — Users')
@Controller('admin/users')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@ApiBearerAuth()
@Throttle({ default: { ttl: 60000, limit: 100 } })
export class AdminEmailVerificationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  @Post(':id/resend-verification')
  @HttpCode(200)
  @ApiOperation({ summary: 'Email the user a fresh verification code' })
  @RequiredPermissions('admin:users')
  async resend(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: JwtPayload,
  ) {
    const user = await this.findUser(id);
    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }
    await this.authService.issueVerificationCode(user, { respectCooldown: false });
    await this.auditService.log({
      actorUserId: actor.sub,
      actorType: 'user',
      action: 'admin.user.resend_verification',
      entityType: 'user',
      entityId: id,
    });
    return { success: true, data: { message: 'Verification code sent.' } };
  }

  @Post(':id/mark-email-verified')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark the user’s email as verified (manual override)' })
  @RequiredPermissions('admin:users')
  async markVerified(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: JwtPayload,
  ) {
    const user = await this.findUser(id);
    if (!user.emailVerified) {
      await this.prisma.user.update({
        where: { id },
        data: {
          emailVerified: true,
          emailVerifyToken: null,
          emailVerifyTokenExpiresAt: null,
        },
      });
    }
    await this.auditService.log({
      actorUserId: actor.sub,
      actorType: 'user',
      action: 'admin.user.mark_email_verified',
      entityType: 'user',
      entityId: id,
      metadata: { emailVerified: { from: user.emailVerified, to: true } },
    });
    return { success: true, data: { emailVerified: true } };
  }

  private async findUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        emailVerified: true,
        emailVerifyTokenExpiresAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
