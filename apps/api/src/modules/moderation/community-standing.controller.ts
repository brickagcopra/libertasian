import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FileAppealDto } from './dto/moderation.dto';
import { ModerationService } from './moderation.service';

/**
 * The signed-in user's side of moderation: the decisions taken against them
 * and their appeals. Everything is keyed to the JWT subject; there is no way
 * to name another user.
 */
@ApiTags('Community — Standing')
@Controller('community/standing')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CommunityStandingController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('decisions')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: 'Removals, suspensions and bans against me, with appeal status' })
  async decisions(@CurrentUser() user: JwtPayload) {
    return { success: true, data: await this.moderation.listMyDecisions(user.sub) };
  }

  @Post('decisions/:id/appeal')
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  @ApiOperation({ summary: 'Appeal one decision (once, within 30 days, while it is in effect)' })
  async appeal(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FileAppealDto,
  ) {
    return { success: true, data: await this.moderation.fileAppeal(user.sub, id, dto.statement) };
  }
}
