import {
  Controller,
  Get,
  Param,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AnalyticsDashboardService } from './analytics-dashboard.service';
import { DashboardQueryDto } from './dto';

/**
 * Admin analytics dashboard endpoints.
 * Restricted to admin/owner roles via RolesGuard.
 *
 * All endpoints read from pre-aggregated tables (analytics_daily_aggregates,
 * analytics_funnel_steps, analytics_retention_cohorts) — NOT from raw events.
 * Results are cached in Redis for 5 minutes.
 */
@ApiTags('Admin Analytics')
@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
@ApiBearerAuth()
export class AnalyticsDashboardController {
  constructor(private readonly dashboardService: AnalyticsDashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Key metrics overview (DAU, WAU, MAU, searches, AI answers, subscribers)' })
  async getOverview(@Query() query: DashboardQueryDto) {
    const data = await this.dashboardService.getOverview(query);
    return { success: true, data };
  }

  @Get('engagement')
  @ApiOperation({ summary: 'DAU/WAU/MAU, sessions, time-on-platform' })
  async getEngagement(@Query() query: DashboardQueryDto) {
    const data = await this.dashboardService.getEngagement(query);
    return { success: true, data };
  }

  @Get('search')
  @ApiOperation({ summary: 'Search quality metrics' })
  async getSearchMetrics(@Query() query: DashboardQueryDto) {
    const data = await this.dashboardService.getSearchMetrics(query);
    return { success: true, data };
  }

  @Get('ai')
  @ApiOperation({ summary: 'AI answer quality metrics' })
  async getAiMetrics(@Query() query: DashboardQueryDto) {
    const data = await this.dashboardService.getAiMetrics(query);
    return { success: true, data };
  }

  @Get('digests')
  @ApiOperation({ summary: 'Digest pipeline metrics' })
  async getDigestMetrics(@Query() query: DashboardQueryDto) {
    const data = await this.dashboardService.getDigestMetrics(query);
    return { success: true, data };
  }

  @Get('scans')
  @ApiOperation({ summary: 'Camera scan funnel + metrics' })
  async getScanMetrics(@Query() query: DashboardQueryDto) {
    const data = await this.dashboardService.getScanMetrics(query);
    return { success: true, data };
  }

  @Get('study')
  @ApiOperation({ summary: 'Study mode engagement' })
  async getStudyMetrics(@Query() query: DashboardQueryDto) {
    const data = await this.dashboardService.getStudyMetrics(query);
    return { success: true, data };
  }

  @Get('workspace')
  @ApiOperation({ summary: 'Workspace adoption metrics' })
  async getWorkspaceMetrics(@Query() query: DashboardQueryDto) {
    const data = await this.dashboardService.getWorkspaceMetrics(query);
    return { success: true, data };
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Subscription + revenue metrics' })
  async getRevenueMetrics(@Query() query: DashboardQueryDto) {
    const data = await this.dashboardService.getRevenueMetrics(query);
    return { success: true, data };
  }

  @Get('funnels/:name')
  @ApiOperation({ summary: 'Specific funnel data' })
  async getFunnel(
    @Param('name') funnelName: string,
    @Query() query: DashboardQueryDto,
  ) {
    const data = await this.dashboardService.getFunnel(funnelName, query);
    return { success: true, data };
  }

  @Get('retention')
  @ApiOperation({ summary: 'Retention cohort matrix' })
  async getRetention(@Query() query: DashboardQueryDto) {
    const data = await this.dashboardService.getRetention(query);
    return { success: true, data };
  }

  @Get('ingestion')
  @ApiOperation({ summary: 'Corpus health + ingestion metrics' })
  async getIngestionMetrics(@Query() query: DashboardQueryDto) {
    const data = await this.dashboardService.getIngestionMetrics(query);
    return { success: true, data };
  }

  @Sse('realtime')
  @ApiOperation({ summary: 'Live event stream (last 5 min, via SSE)' })
  realtime(): Observable<MessageEvent> {
    return this.dashboardService.getRealtimeStream();
  }
}
