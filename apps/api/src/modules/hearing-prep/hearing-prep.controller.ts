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
import { HearingPrepService } from './hearing-prep.service';
import { GenerateHearingPrepDto, ListHearingPrepQueryDto } from './dto';

/**
 * Hearing Prep controller — AI-generated hearing preparation packs.
 * Requires Team+ subscription (quota enforced at service layer).
 */
@ApiTags('Hearing Prep')
@Controller('hearing-prep')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class HearingPrepController {
  constructor(
    private readonly service: HearingPrepService,
    private readonly auditService: AuditService,
  ) {}

  @Post('generate')
  @ApiOperation({ summary: 'Trigger AI hearing prep pack generation' })
  async generate(
    @Body() dto: GenerateHearingPrepDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const pack = await this.service.triggerGeneration(
      dto,
      user.sub,
      user.organizationId,
      { isPlatformAdmin: user.isPlatformAdmin === true },
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'hearing_prep.generate',
      entityType: 'hearing_prep',
      entityId: pack.id,
      metadata: {
        ip,
        topic: dto.topic,
        hasIssue: !!dto.issue,
        documentCount: dto.documentIds?.length ?? 0,
        matterId: dto.matterId,
      },
    });
    return { success: true, data: pack };
  }

  @Get()
  @ApiOperation({ summary: 'List hearing prep packs with cursor pagination' })
  async list(
    @Query() query: ListHearingPrepQueryDto,
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
  @ApiOperation({ summary: 'Get a hearing prep pack by ID' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const pack = await this.service.findById(
      id,
      user.sub,
      user.organizationId,
    );
    return { success: true, data: pack };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a hearing prep pack' })
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
      action: 'hearing_prep.delete',
      entityType: 'hearing_prep',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Hearing prep pack deleted' } };
  }

  /**
   * SSE endpoint for streaming hearing prep generation progress.
   */
  @Sse(':id/stream')
  @ApiOperation({ summary: 'Stream hearing prep generation progress via SSE' })
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
