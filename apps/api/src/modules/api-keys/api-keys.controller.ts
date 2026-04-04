import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  JwtAuthGuard,
  MfaGuard,
  TenantGuard,
  PermissionsGuard,
  SubscriptionGuard,
} from '../../common/guards';
import {
  CurrentUser,
  RequiredPermissions,
  RequiredSubscription,
} from '../../common/decorators';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { ListApiKeysDto } from './dto/list-api-keys.dto';

@Controller('api-keys')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard, SubscriptionGuard)
@RequiredSubscription('enterprise')
@RequiredPermissions('organizations:update')
@Throttle({ default: { limit: 100, ttl: 60000 } })
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  async create(
    @CurrentUser() user: { sub: string; organizationId: string },
    @Body() dto: CreateApiKeyDto,
  ) {
    const result = await this.apiKeysService.create(
      user.organizationId,
      user.sub,
      dto,
    );
    return { success: true, data: result };
  }

  @Get()
  async findAll(
    @CurrentUser() user: { organizationId: string },
    @Query() dto: ListApiKeysDto,
  ) {
    const result = await this.apiKeysService.findAll(
      user.organizationId,
      dto,
    );
    return { success: true, ...result };
  }

  @Get(':id')
  async findOne(
    @CurrentUser() user: { organizationId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.apiKeysService.findOne(
      user.organizationId,
      id,
    );
    return { success: true, data: result };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: { organizationId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApiKeyDto,
  ) {
    const result = await this.apiKeysService.update(
      user.organizationId,
      id,
      dto,
    );
    return { success: true, data: result };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: { organizationId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.apiKeysService.remove(user.organizationId, id);
  }
}
