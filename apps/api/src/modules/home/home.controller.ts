import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HomeFeedQueryDto } from './dto';
import { HomeService } from './home.service';

/**
 * Home / landing feed.
 *
 * - JWT-authenticated. Tenant scoping is enforced server-side from
 *   `JwtPayload.organizationId`; client-supplied org ids are never trusted.
 * - Read-only endpoint, so no audit log entry is written (audit logs are
 *   reserved for state-changing operations per CLAUDE.md).
 * - Cached per-user in Redis (`cache:feed:{userId}`, 5-min TTL).
 */
@ApiTags('Home')
@Controller('home')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get('feed')
  @ApiOperation({
    summary:
      'Get personalised landing feed (todaysBrief + forYou). Cursor-paginated.',
  })
  // Tighter than the default General API limit. The Home tab opens on every
  // app launch and on every back-to-root navigation, so a 60/min ceiling
  // protects upstream Postgres and Redis without disrupting normal use.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getFeed(
    @Query() dto: HomeFeedQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.homeService.getFeed(
      user.sub,
      user.organizationId,
      dto,
    );
    return { success: true, data };
  }
}
