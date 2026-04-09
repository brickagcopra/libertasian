import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AdsService } from './ads.service';
import { RecordEventDto } from './dto';

@ApiTags('Ads')
@Controller('ads')
export class AdsController {
  constructor(private readonly adsService: AdsService) {}

  @Get('active')
  @ApiOperation({ summary: 'Get active ad campaigns for a page' })
  async getActiveCampaigns(
    @Query('page') page: string,
    @Query('userType') userType?: string,
  ) {
    const data = await this.adsService.getActiveCampaigns(page || 'homepage', userType);
    return { success: true, data };
  }

  @Post('events')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: 'Record an ad event (impression/click/dismiss)' })
  async recordEvent(
    @Body() dto: RecordEventDto,
    @Req() req: Request,
  ) {
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    const userAgent = req.headers['user-agent']?.substring(0, 255);
    const user = req.user as { sub?: string } | undefined;

    await this.adsService.recordEvent(dto, ipAddress, userAgent, user?.sub);
    return { success: true };
  }
}
