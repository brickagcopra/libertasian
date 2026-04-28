import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { BarExamsService } from './bar-exams.service';

/**
 * Public read endpoints for past Philippine Bar Examinations.
 * No auth required — bar exam questions are official public-domain content.
 */
@ApiTags('Bar Exams')
@Controller('bar-exams')
export class BarExamsController {
  constructor(private readonly service: BarExamsService) {}

  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({
    summary:
      'List every available past bar exam sitting, grouped by year DESC.',
  })
  async list() {
    const data = await this.service.listAll();
    return { success: true, data };
  }

  @Get(':year')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({ summary: 'List subjects sat in a given bar exam year.' })
  async listByYear(@Param('year', ParseIntPipe) year: number) {
    const data = await this.service.listByYear(year);
    return { success: true, data };
  }

  @Get(':year/:subjectCode')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({
    summary:
      'Get a single sitting (header + all questions) for a year/subject. ' +
      'Use ?part=I or ?part=II to disambiguate the 2022 split papers.',
  })
  async getSitting(
    @Param('year', ParseIntPipe) year: number,
    @Param('subjectCode') subjectCode: string,
    @Query('part') part?: string,
  ) {
    const normalizedPart = normalizeOptionalPart(part);
    const data = await this.service.getSittingByYearAndSubject(
      year,
      subjectCode,
      normalizedPart,
    );
    return { success: true, data };
  }
}

/**
 * Treat unset / empty / "none" as null so the URL surface stays clean for
 * single-paper subjects (legacy 2006-2018) without forcing callers to
 * pass an explicit ``part=`` value. Anything else is passed through; the
 * service rejects unknown parts with 404 via Prisma's exact-match.
 */
function normalizeOptionalPart(part: string | undefined): string | null {
  if (part === undefined || part === '' || part === 'none') return null;
  if (!/^[A-Za-z0-9]+$/.test(part)) {
    throw new NotFoundException(`Unknown bar exam part: ${part}`);
  }
  return part.toUpperCase();
}
