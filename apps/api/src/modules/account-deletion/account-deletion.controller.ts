import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { AccountDeletionService } from './account-deletion.service';
import { DeleteAccountDto } from './dto/delete-account.dto';

/**
 * Self-serve account deletion — required by Apple App Store 5.1.1(v) and
 * Google Play's data-deletion policy.
 *
 * Lives on `users/me` alongside the rest of the personal-profile surface;
 * it is a separate controller because the deletion flow owns its own service,
 * cron, and purge queue.
 *
 * Both routes act on the CALLER only — the user id comes from the verified JWT,
 * never from a path or body parameter, so there is no way to address another
 * account here.
 */
@ApiTags('Users')
@Controller('users')
export class AccountDeletionController {
  constructor(private readonly accountDeletion: AccountDeletionService) {}

  @Delete('me')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth()
  // Deliberately tight: this is a destructive, once-per-account action, and a
  // per-user bucket costs a NAT-shared firm nothing.
  @Throttle({ default: { ttl: 3_600_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete the current account',
    description:
      'Deactivates the account immediately and schedules permanent deletion ' +
      'after a 30-day restore window. Requires the password, or — for ' +
      'social-only accounts — an exact echo of the account email.',
  })
  async deleteMe(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: DeleteAccountDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    const data = await this.accountDeletion.requestDeletion(payload.sub, dto, {
      ip,
      userAgent: req.headers['user-agent'] ?? '',
    });
    return { success: true, data };
  }

  @Post('me/deletion/cancel')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth()
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a pending account deletion',
    description: 'Restores the account if the 30-day window has not closed.',
  })
  async cancelDeletion(@CurrentUser() payload: JwtPayload) {
    const data = await this.accountDeletion.cancelDeletion(payload.sub);
    return { success: true, data };
  }
}
