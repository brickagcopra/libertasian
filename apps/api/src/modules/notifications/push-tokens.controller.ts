import { Body, Controller, Delete, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PushService } from './push.service';
import { RegisterPushTokenDto, UnregisterPushTokenDto } from './dto';

/**
 * Device push token registration. NOTE: this controller must be registered
 * BEFORE NotificationCenterController in the module so that
 * `DELETE /notifications/push-tokens` is not swallowed by its
 * `DELETE /notifications/:id` route.
 */
@ApiTags('Notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('notifications/push-tokens')
export class PushTokensController {
  constructor(private readonly pushService: PushService) {}

  @Post()
  @ApiOperation({ summary: 'Register (upsert) an Expo push token for this device' })
  async registerToken(
    @Body() dto: RegisterPushTokenDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.pushService.registerToken(user.sub, dto.token, dto.platform);
    return { success: true, data: { message: 'Push token registered' } };
  }

  @Delete()
  @ApiOperation({ summary: 'Unregister an Expo push token owned by the caller' })
  async unregisterToken(
    @Body() dto: UnregisterPushTokenDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const count = await this.pushService.unregisterToken(user.sub, dto.token);
    return { success: true, data: { removed: count } };
  }
}
