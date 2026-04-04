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
import { MemosService } from './memos.service';
import { GenerateMemoDto, ListMemosQueryDto } from './dto';

/**
 * Memos controller — legal memo drafting via AI.
 * Requires Pro+ subscription (quota enforced at service layer).
 */
@ApiTags('Memos')
@Controller('memos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MemosController {
  constructor(
    private readonly memosService: MemosService,
    private readonly auditService: AuditService,
  ) {}

  @Post('generate')
  @ApiOperation({ summary: 'Trigger AI memo generation' })
  async generate(
    @Body() dto: GenerateMemoDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const memo = await this.memosService.triggerGeneration(
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'memo.generate',
      entityType: 'legal_memo',
      entityId: memo.id,
      metadata: { ip, memoType: dto.memoType, matterId: dto.matterId },
    });
    return { success: true, data: memo };
  }

  @Get()
  @ApiOperation({ summary: 'List memos with cursor pagination and filters' })
  async list(
    @Query() query: ListMemosQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.memosService.list(
      user.sub,
      user.organizationId,
      query,
    );
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a memo by ID' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const memo = await this.memosService.findById(
      id,
      user.sub,
      user.organizationId,
    );
    return { success: true, data: memo };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a memo' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.memosService.delete(id, user.sub, user.organizationId);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'memo.delete',
      entityType: 'legal_memo',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Memo deleted' } };
  }

  /**
   * SSE endpoint for streaming memo generation progress.
   * Client connects and receives status updates every 2 seconds until
   * the memo reaches a terminal state (completed or failed).
   */
  @Sse(':id/stream')
  @ApiOperation({ summary: 'Stream memo generation progress via SSE' })
  streamStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Observable<{ data: string }> {
    const userId = user.sub;
    const organizationId = user.organizationId;

    // Poll every 2 seconds until terminal state
    return interval(2000).pipe(
      switchMap(() =>
        from(this.memosService.getStatus(id, userId, organizationId)),
      ),
      map((status) => ({
        data: JSON.stringify(status),
      })),
      takeWhile(
        (event) => {
          const parsed = JSON.parse(event.data) as { status: string };
          return parsed.status !== 'completed' && parsed.status !== 'failed';
        },
        true, // include the terminal event
      ),
    );
  }
}
