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
import { IsIn, IsOptional } from 'class-validator';
import { Observable, from, interval, map, switchMap, takeWhile } from 'rxjs';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuditService } from '../audit/audit.service';
import { PleadingsService } from './pleadings.service';
import { GeneratePleadingDto, ListPleadingsQueryDto } from './dto';

/**
 * Pleadings controller — AI-assisted pleading drafting from templates.
 * Requires Pro+ subscription (quota enforced at service layer).
 */
@ApiTags('Pleadings')
@Controller('pleadings')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PleadingsController {
  constructor(
    private readonly service: PleadingsService,
    private readonly auditService: AuditService,
  ) {}

  @Post('generate')
  @ApiOperation({ summary: 'Trigger AI pleading generation from template' })
  async generate(
    @Body() dto: GeneratePleadingDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const pleading = await this.service.triggerGeneration(
      dto,
      user.sub,
      user.organizationId,
      { isPlatformAdmin: user.isPlatformAdmin === true },
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'pleading.generate',
      entityType: 'pleading',
      entityId: pleading.id,
      metadata: { ip, templateId: dto.templateId, matterId: dto.matterId },
    });
    return { success: true, data: pleading };
  }

  @Get('templates')
  @ApiOperation({ summary: 'List active pleading templates' })
  async listTemplates(
    @Query('category') category?: string,
  ) {
    const templates = await this.service.listTemplates(category);
    return { success: true, data: templates };
  }

  @Get('templates/:id')
  @ApiOperation({ summary: 'Get pleading template with full schema' })
  async getTemplate(@Param('id', ParseUUIDPipe) id: string) {
    const template = await this.service.getTemplate(id);
    return { success: true, data: template };
  }

  @Get()
  @ApiOperation({ summary: 'List pleadings with cursor pagination' })
  async list(
    @Query() query: ListPleadingsQueryDto,
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
  @ApiOperation({ summary: 'Get a pleading by ID' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const pleading = await this.service.findById(
      id,
      user.sub,
      user.organizationId,
    );
    return { success: true, data: pleading };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a pleading' })
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
      action: 'pleading.delete',
      entityType: 'pleading',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Pleading deleted' } };
  }

  /**
   * SSE endpoint for streaming pleading generation progress.
   */
  @Sse(':id/stream')
  @ApiOperation({ summary: 'Stream pleading generation progress via SSE' })
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
