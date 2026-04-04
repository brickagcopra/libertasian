import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { ResearchWorkspacesService } from './research-workspaces.service';
import {
  AskResearchQueryDto,
  CreateResearchWorkspaceDto,
  ListResearchWorkspacesQueryDto,
  UpdateResearchWorkspaceDto,
} from './dto';

/**
 * Research Workspaces controller — persistent AI-assisted research context.
 * Requires Pro+ subscription (maxResearchWorkspaces entitlement).
 */
@ApiTags('Research Workspaces')
@Controller('research-workspaces')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ResearchWorkspacesController {
  constructor(
    private readonly service: ResearchWorkspacesService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new research workspace' })
  async create(
    @Body() dto: CreateResearchWorkspaceDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const workspace = await this.service.create(
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'research_workspace.create',
      entityType: 'research_workspace',
      entityId: workspace.id,
      metadata: { ip, title: dto.title },
    });
    return { success: true, data: workspace };
  }

  @Get()
  @ApiOperation({ summary: 'List research workspaces with cursor pagination' })
  async list(
    @Query() query: ListResearchWorkspacesQueryDto,
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
  @ApiOperation({ summary: 'Get a research workspace by ID' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const workspace = await this.service.findById(
      id,
      user.sub,
      user.organizationId,
    );
    return { success: true, data: workspace };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a research workspace' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateResearchWorkspaceDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const workspace = await this.service.update(
      id,
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'research_workspace.update',
      entityType: 'research_workspace',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: workspace };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a research workspace and all its queries' })
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
      action: 'research_workspace.delete',
      entityType: 'research_workspace',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Research workspace deleted' } };
  }

  // ─── Query Endpoints ──────────────────────────────────────────────

  @Post(':id/queries')
  @ApiOperation({ summary: 'Ask a research query within workspace context' })
  async askQuery(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AskResearchQueryDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const query = await this.service.askQuery(
      id,
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'research_workspace.query',
      entityType: 'research_query',
      entityId: query.id,
      metadata: { ip, workspaceId: id },
    });
    return { success: true, data: query };
  }

  @Get(':id/queries')
  @ApiOperation({ summary: 'List queries within a research workspace' })
  async listQueries(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.service.listQueries(
      id,
      user.sub,
      user.organizationId,
    );
    return { success: true, data: result.items, meta: result.meta };
  }

  /**
   * SSE endpoint for streaming research query progress.
   */
  @Sse(':id/queries/:queryId/stream')
  @ApiOperation({ summary: 'Stream research query progress via SSE' })
  streamQueryStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('queryId', ParseUUIDPipe) queryId: string,
    @CurrentUser() user: JwtPayload,
  ): Observable<{ data: string }> {
    const userId = user.sub;
    const organizationId = user.organizationId;

    return interval(2000).pipe(
      switchMap(() =>
        from(
          this.service.getQueryStatus(queryId, id, userId, organizationId),
        ),
      ),
      map((status) => ({
        data: JSON.stringify(status),
      })),
      takeWhile(
        (event) => {
          const parsed = JSON.parse(event.data) as { status: string };
          return parsed.status !== 'completed';
        },
        true,
      ),
    );
  }
}
