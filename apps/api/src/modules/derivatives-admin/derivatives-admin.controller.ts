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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { DerivativesAdminService } from './derivatives-admin.service';
import {
  EnqueueGenerationDto,
  ListDerivativeJobsDto,
  UpdateDerivativeSettingsDto,
} from './dto';

@ApiTags('Derivatives Admin')
@Controller('admin/derivatives')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions('admin:settings')
@ApiBearerAuth()
export class DerivativesAdminController {
  constructor(private readonly service: DerivativesAdminService) {}

  @Get('stats')
  async getStats() {
    const data = await this.service.getStats();
    return { success: true, data };
  }

  @Get('settings')
  async getSettings() {
    const data = await this.service.getDerivativeSettings();
    return { success: true, data };
  }

  @Patch('settings')
  async updateSettings(
    @Body() dto: UpdateDerivativeSettingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.service.updateDerivativeSettings(dto, user.sub);
    return { success: true };
  }

  @Post('generate')
  async enqueueGeneration(
    @Body() dto: EnqueueGenerationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.service.enqueueGeneration(dto, user.sub);
    return { success: true, data };
  }

  @Get('jobs')
  async getJobs(@Query() dto: ListDerivativeJobsDto) {
    const data = await this.service.getJobs(dto);
    return { success: true, data };
  }

  @Get('jobs/:id')
  async getJob(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.service.getJob(id);
    return { success: true, data };
  }

  @Get('jobs/:id/digest')
  @ApiOperation({ summary: 'Get the digest artifact produced by a derivative generation job' })
  async getJobDigest(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.service.getJobDigest(id);
    return { success: true, data };
  }

  @Get('jobs/:id/doctrines')
  @ApiOperation({ summary: 'Get doctrine extracts produced by a derivative generation job' })
  async getJobDoctrines(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.service.getJobDoctrines(id);
    return { success: true, data };
  }

  @Get('jobs/:id/essay')
  @ApiOperation({ summary: 'Get the essay prompt artifact produced by a derivative generation job' })
  async getJobEssay(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.service.getJobEssay(id);
    return { success: true, data };
  }

  @Post('jobs/:id/retry')
  async retryJob(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.service.retryJob(id, user.sub);
    return { success: true };
  }

  @Post('artifacts/:id/regenerate')
  async regenerateArtifact(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.service.regenerateArtifact(id, user.sub);
    return { success: true, data };
  }

  @Delete('jobs/:id/output')
  @ApiOperation({ summary: 'Delete the output (digest or artifact) produced by a derivative generation job' })
  async deleteJobOutput(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.service.deleteJobOutput(id, user.sub);
    return { success: true };
  }

  @Delete('artifacts/:id')
  async softDeleteArtifact(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.service.softDeleteArtifact(id, user.sub);
    return { success: true };
  }
}
