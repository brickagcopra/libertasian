import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { GoldenSetsService } from './golden-sets.service';
import {
  CreateGoldenSetEntryDto,
  UpdateGoldenSetEntryDto,
  ListGoldenSetsQueryDto,
  BulkApproveDto,
} from './dto';

@ApiTags('Admin — Golden Sets')
@Controller('admin/golden-sets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions({ permissions: ['admin:settings'], mode: 'any' })
@Throttle({ default: { ttl: 60000, limit: 100 } })
export class GoldenSetsController {
  constructor(private readonly service: GoldenSetsService) {}

  @Get()
  async findAll(@Query() query: ListGoldenSetsQueryDto) {
    return this.service.findAll(query);
  }

  @Get('stats')
  async getStats() {
    return this.service.getStats();
  }

  @Get('evaluations')
  async getEvaluationRuns(@Query('type') type?: string) {
    return this.service.getEvaluationRuns(type);
  }

  @Get('evaluations/:id')
  async getEvaluationRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getEvaluationRun(id);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateGoldenSetEntryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGoldenSetEntryDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
    return { success: true };
  }

  @Post(':id/approve')
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body?: { notes?: string },
  ) {
    return this.service.approve(id, user.sub, body?.notes);
  }

  @Post(':id/reject')
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { notes: string },
  ) {
    return this.service.reject(id, user.sub, body.notes);
  }

  @Post('bulk-approve')
  async bulkApprove(
    @Body() dto: BulkApproveDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.bulkApprove(dto.ids, user.sub);
  }

  @Post('generate/digests')
  async generateDraftDigests(@Body() body?: { count?: number }) {
    return this.service.generateDraftDigests(body?.count);
  }

  @Post('generate/classifications')
  async generateDraftClassifications(@Body() body?: { count?: number }) {
    return this.service.generateDraftClassifications(body?.count);
  }

  @Post('generate/mcq-sample')
  async sampleMcqGoldenSet(@Body() body?: { count?: number }) {
    return this.service.sampleMcqGoldenSet(body?.count);
  }
}
