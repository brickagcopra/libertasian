import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@libertasian/types';
import { Observable, from, interval, map, switchMap, takeWhile } from 'rxjs';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuditService } from '../audit/audit.service';
import { TimelinesService } from './timelines.service';
import { GenerateTimelineDto, ListTimelinesQueryDto } from './dto';

/**
 * Timelines controller — chronological event extraction from legal documents.
 * Requires Pro+ subscription (quota enforced at service layer).
 */
@ApiTags('Timelines')
@Controller('timelines')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TimelinesController {
  constructor(
    private readonly service: TimelinesService,
    private readonly auditService: AuditService,
  ) {}

  @Post('generate')
  @ApiOperation({ summary: 'Trigger AI timeline generation from documents' })
  async generate(
    @Body() dto: GenerateTimelineDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const timeline = await this.service.triggerGeneration(
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'timeline.generate',
      entityType: 'timeline',
      entityId: timeline.id,
      metadata: {
        ip,
        title: dto.title,
        documentCount: dto.documentIds.length,
        matterId: dto.matterId,
      },
    });
    return { success: true, data: timeline };
  }

  @Get()
  @ApiOperation({ summary: 'List timelines with cursor pagination' })
  async list(
    @Query() query: ListTimelinesQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.service.list(
      user.sub,
      user.organizationId,
      query,
    );
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a timeline by ID' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const timeline = await this.service.findById(
      id,
      user.sub,
      user.organizationId,
    );
    return { success: true, data: timeline };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a timeline' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.service.delete(id, user.sub, user.organizationId);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'timeline.delete',
      entityType: 'timeline',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Timeline deleted' } };
  }

  /**
   * SSE endpoint for streaming timeline generation progress.
   */
  @Sse(':id/stream')
  @ApiOperation({ summary: 'Stream timeline generation progress via SSE' })
  streamStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Observable<{ data: string }> {
    const userId = user.sub;
    const organizationId = user.organizationId;

    return interval(2000).pipe(
      switchMap(() =>
        from(this.service.getStatus(id, userId, organizationId)),
      ),
      map((status) => ({
        data: JSON.stringify(status),
      })),
      takeWhile(
        (event) => {
          const parsed = JSON.parse(event.data) as { status: string };
          return parsed.status !== 'completed' && parsed.status !== 'failed';
        },
        true,
      ),
    );
  }
}
