import {
  Body,
  Controller,
  Headers,
  Ip,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';
import { TrackEventDto, TrackBatchDto, StartSessionDto, HeartbeatDto, EndSessionDto } from './dto';

/**
 * Analytics event ingestion endpoints.
 *
 * Per LIBERTASIAN-ANALYTICS.md spec:
 * - POST /events: single event (returns immediately, enqueues to BullMQ)
 * - POST /events/batch: batch events (mobile offline sync)
 * - POST /sessions/start: start session
 * - POST /sessions/heartbeat: keepalive
 * - POST /sessions/end: end session
 *
 * Rate limits: 100 events/min per user, 500 events/min per IP for unauth.
 * JwtAuthGuard is optional — unauthenticated tracking allowed for pre-auth events.
 */
@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Track a single analytics event' })
  async trackEvent(
    @Body() dto: TrackEventDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-user-id') headerUserId?: string,
    @Headers('x-organization-id') headerOrgId?: string,
    @Headers('x-app-version') appVersion?: string,
    @Headers('x-screen-resolution') screenResolution?: string,
  ) {
    await this.analyticsService.track({
      eventName: dto.eventName,
      sessionId: dto.sessionId,
      deviceType: dto.deviceType,
      properties: dto.properties,
      durationMs: dto.durationMs,
      userId: headerUserId,
      organizationId: headerOrgId,
      ipAddress: ip,
      userAgent,
      appVersion,
      screenResolution,
    });

    return { success: true };
  }

  @Post('events/auth')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Track event with authenticated user context' })
  async trackEventAuthenticated(
    @Body() dto: TrackEventDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-app-version') appVersion?: string,
    @Headers('x-screen-resolution') screenResolution?: string,
  ) {
    await this.analyticsService.track({
      eventName: dto.eventName,
      sessionId: dto.sessionId,
      deviceType: dto.deviceType,
      properties: dto.properties,
      durationMs: dto.durationMs,
      userId: user.sub,
      organizationId: user.organizationId,
      ipAddress: ip,
      userAgent,
      appVersion,
      screenResolution,
    });

    return { success: true };
  }

  @Post('events/batch')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 500, ttl: 60000 } })
  @ApiOperation({ summary: 'Track batch of events (mobile offline sync)' })
  async trackBatch(
    @Body() dto: TrackBatchDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-user-id') headerUserId?: string,
    @Headers('x-organization-id') headerOrgId?: string,
  ) {
    await this.analyticsService.trackBatch(dto.events, {
      userId: headerUserId,
      organizationId: headerOrgId,
      ipAddress: ip,
      userAgent,
    });

    return { success: true, count: dto.events.length };
  }

  @Post('sessions/start')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start a new analytics session' })
  async startSession(
    @Body() dto: StartSessionDto,
    @Headers('x-user-id') headerUserId?: string,
    @Headers('x-organization-id') headerOrgId?: string,
  ) {
    const sessionId = await this.analyticsService.startSession({
      userId: headerUserId,
      organizationId: headerOrgId,
      deviceType: dto.deviceType,
      entryPath: dto.entryPath,
      referrer: dto.referrer,
      properties: dto.properties,
    });

    return { success: true, data: { sessionId } };
  }

  @Post('sessions/start/auth')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start session with authenticated user context' })
  async startSessionAuthenticated(
    @Body() dto: StartSessionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const sessionId = await this.analyticsService.startSession({
      userId: user.sub,
      organizationId: user.organizationId,
      deviceType: dto.deviceType,
      entryPath: dto.entryPath,
      referrer: dto.referrer,
      properties: dto.properties,
    });

    return { success: true, data: { sessionId } };
  }

  @Post('sessions/heartbeat')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Session heartbeat (keepalive)' })
  async heartbeat(@Body() dto: HeartbeatDto) {
    await this.analyticsService.heartbeat(dto.sessionId, dto.currentPath);
  }

  @Post('sessions/end')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End an analytics session' })
  async endSession(@Body() dto: EndSessionDto) {
    await this.analyticsService.endSession(dto.sessionId);
  }
}
