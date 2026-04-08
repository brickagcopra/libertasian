import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Header,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import { CurrentUser, RequiredPermissions } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { SiteContentService } from './site-content.service';
import { UpdateSiteContentDto } from './dto';

@ApiTags('Site Content')
@Controller('site-content')
export class SiteContentController {
  constructor(
    private readonly siteContentService: SiteContentService,
    private readonly auditService: AuditService,
  ) {}

  @Get(':key')
  @ApiOperation({ summary: 'Get site content by key (public)' })
  @Header('Cache-Control', 'public, max-age=300, s-maxage=300')
  async findByKey(@Param('key') key: string) {
    const record = await this.siteContentService.findByKey(key);
    return {
      success: true,
      data: {
        key: record.key,
        content: record.content,
        version: record.version,
        updatedAt: record.updatedAt,
      },
    };
  }

  @Put(':key')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiredPermissions({ permissions: ['admin:settings'], mode: 'any' })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upsert site content by key (admin only)' })
  async upsert(
    @Param('key') key: string,
    @Body() dto: UpdateSiteContentDto,
    @CurrentUser() user: { sub: string; organizationId: string },
  ) {
    const record = await this.siteContentService.upsert(
      key,
      dto.content,
      user.sub,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'site-content.upsert',
      entityType: 'site-content',
      entityId: record.id,
      metadata: { key, version: record.version },
    });

    return {
      success: true,
      data: {
        key: record.key,
        content: record.content,
        version: record.version,
        updatedBy: record.updatedBy,
        updatedAt: record.updatedAt,
      },
    };
  }

  @Delete(':key')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiredPermissions({ permissions: ['admin:settings'], mode: 'any' })
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete site content by key (admin only)' })
  async deleteByKey(
    @Param('key') key: string,
    @CurrentUser() user: { sub: string; organizationId: string },
  ) {
    await this.siteContentService.deleteByKey(key);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'site-content.delete',
      entityType: 'site-content',
      metadata: { key },
    });
  }
}
