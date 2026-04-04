import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateExportDto, ListExportsQueryDto } from './dto';
import { ExportsService } from './exports.service';

@Controller('exports')
@UseGuards(JwtAuthGuard)
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  // POST /api/v1/exports — Create a new export
  @Post()
  async createExport(
    @Body() dto: CreateExportDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const job = await this.exportsService.createExport(
      dto.contentType,
      dto.contentId,
      dto.format,
      user.sub,
      user.organizationId,
      ip,
    );

    return { success: true, data: job };
  }

  // GET /api/v1/exports — List user's exports
  @Get()
  async listExports(
    @Query() query: ListExportsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const limit = query.limit ?? 20;
    const { data, nextCursor } = await this.exportsService.listExports(
      user.sub,
      user.organizationId,
      query.cursor,
      limit,
      query.contentType,
    );

    return { success: true, data, nextCursor };
  }

  // GET /api/v1/exports/:id — Get export job status
  @Get(':id')
  async getExport(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const job = await this.exportsService.getExport(id, user.sub, user.organizationId);
    return { success: true, data: job };
  }

  // GET /api/v1/exports/:id/download — Download export file
  @Get(':id/download')
  async downloadExport(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const { buffer, filename, mimeType, fileSize } = await this.exportsService.downloadExport(
      id,
      user.sub,
      user.organizationId,
    );

    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      ...(fileSize != null && { 'Content-Length': fileSize.toString() }),
    });

    res.end(buffer);
  }
}
