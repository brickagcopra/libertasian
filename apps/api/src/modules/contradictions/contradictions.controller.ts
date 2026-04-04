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
import { ContradictionsService } from './contradictions.service';
import {
  GenerateContradictionReportDto,
  ListContradictionReportsQueryDto,
} from './dto';

/**
 * Contradictions controller — detect contradictions across legal authorities.
 * Requires Team+ subscription (quota enforced at service layer).
 */
@ApiTags('Contradictions')
@Controller('contradictions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ContradictionsController {
  constructor(
    private readonly service: ContradictionsService,
    private readonly auditService: AuditService,
  ) {}

  @Post('generate')
  @ApiOperation({ summary: 'Trigger contradiction detection across documents' })
  async generate(
    @Body() dto: GenerateContradictionReportDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const report = await this.service.triggerGeneration(
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'contradiction.generate',
      entityType: 'contradiction_report',
      entityId: report.id,
      metadata: {
        ip,
        scope: dto.scope ?? 'selected',
        topic: dto.topic,
        documentCount: dto.documentIds.length,
      },
    });
    return { success: true, data: report };
  }

  @Get()
  @ApiOperation({ summary: 'List contradiction reports with cursor pagination' })
  async list(
    @Query() query: ListContradictionReportsQueryDto,
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
  @ApiOperation({ summary: 'Get a contradiction report by ID' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const report = await this.service.findById(
      id,
      user.sub,
      user.organizationId,
    );
    return { success: true, data: report };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a contradiction report' })
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
      action: 'contradiction.delete',
      entityType: 'contradiction_report',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Contradiction report deleted' } };
  }

  /**
   * SSE endpoint for streaming contradiction detection progress.
   */
  @Sse(':id/stream')
  @ApiOperation({ summary: 'Stream contradiction detection progress via SSE' })
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
