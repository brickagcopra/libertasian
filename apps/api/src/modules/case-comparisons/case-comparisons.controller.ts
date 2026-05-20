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
import { CaseComparisonsService } from './case-comparisons.service';
import {
  GenerateCaseComparisonDto,
  ListCaseComparisonsQueryDto,
} from './dto';

/**
 * Case Comparisons controller — side-by-side analysis of 2-5 legal documents.
 * Requires Pro+ subscription (quota enforced at service layer).
 */
@ApiTags('Case Comparisons')
@Controller('case-comparisons')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CaseComparisonsController {
  constructor(
    private readonly service: CaseComparisonsService,
    private readonly auditService: AuditService,
  ) {}

  @Post('generate')
  @ApiOperation({ summary: 'Trigger AI case comparison generation' })
  async generate(
    @Body() dto: GenerateCaseComparisonDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const comparison = await this.service.triggerGeneration(
      dto,
      user.sub,
      user.organizationId,
      { isPlatformAdmin: user.isPlatformAdmin === true },
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'case_comparison.generate',
      entityType: 'case_comparison',
      entityId: comparison.id,
      metadata: {
        ip,
        comparisonType: dto.comparisonType,
        documentCount: dto.documentIds.length,
        matterId: dto.matterId,
      },
    });
    return { success: true, data: comparison };
  }

  @Get()
  @ApiOperation({ summary: 'List case comparisons with cursor pagination' })
  async list(
    @Query() query: ListCaseComparisonsQueryDto,
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
  @ApiOperation({ summary: 'Get a case comparison by ID' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const comparison = await this.service.findById(
      id,
      user.sub,
      user.organizationId,
    );
    return { success: true, data: comparison };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a case comparison' })
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
      action: 'case_comparison.delete',
      entityType: 'case_comparison',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Case comparison deleted' } };
  }

  /**
   * SSE endpoint for streaming comparison generation progress.
   */
  @Sse(':id/stream')
  @ApiOperation({ summary: 'Stream comparison generation progress via SSE' })
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
