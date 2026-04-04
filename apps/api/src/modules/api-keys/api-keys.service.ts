import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import type { CreateApiKeyDto } from './dto/create-api-key.dto';
import type { UpdateApiKeyDto } from './dto/update-api-key.dto';
import type { ListApiKeysDto } from './dto/list-api-keys.dto';

const VALID_PERMISSIONS = [
  'search',
  'documents:read',
  'digests:read',
  'memos:generate',
  'memos:read',
  'comparisons:generate',
  'comparisons:read',
];

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  /**
   * Create a new API key. The raw key is returned once and never stored.
   */
  async create(
    organizationId: string,
    userId: string,
    dto: CreateApiKeyDto,
  ) {
    // Validate permissions
    const invalid = dto.permissions.filter(
      (p) => !VALID_PERMISSIONS.includes(p),
    );
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid permissions: ${invalid.join(', ')}. Valid: ${VALID_PERMISSIONS.join(', ')}`,
      );
    }

    // Check entitlement (maxApiKeys)
    const entitlements =
      await this.subscriptionsService.getEntitlements(organizationId);
    const maxKeys = entitlements.maxApiKeys;
    if (maxKeys != null) {
      const existingCount = await this.prisma.apiKey.count({
        where: { organizationId, isActive: true },
      });
      if (existingCount >= maxKeys) {
        throw new ForbiddenException(
          `API key limit reached (${maxKeys}). Deactivate existing keys or upgrade your plan.`,
        );
      }
    }

    // Generate the raw API key: lib_<32 random hex chars>
    const rawKeyBytes = randomBytes(32);
    const rawKey = `lib_${rawKeyBytes.toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.slice(0, 11); // "lib_" + first 7 hex chars

    const apiKey = await this.prisma.apiKey.create({
      data: {
        organizationId,
        userId,
        name: dto.name,
        keyHash,
        keyPrefix,
        permissions: dto.permissions,
        rateLimitPerMinute: dto.rateLimitPerMinute ?? 60,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    this.logger.log(
      `API key created: ${apiKey.id} (${keyPrefix}...) for org ${organizationId}`,
    );

    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      key: rawKey,
    };
  }

  /**
   * List API keys for an organization (cursor-based pagination).
   */
  async findAll(organizationId: string, dto: ListApiKeysDto) {
    const limit = dto.limit ?? 20;

    const items = await this.prisma.apiKey.findMany({
      where: { organizationId },
      take: limit + 1,
      ...(dto.cursor && { skip: 1, cursor: { id: dto.cursor } }),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        permissions: true,
        rateLimitPerMinute: true,
        isActive: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    const hasNext = items.length > limit;
    if (hasNext) items.pop();

    return {
      data: items.map((k) => ({
        ...k,
        permissions: k.permissions as string[],
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        expiresAt: k.expiresAt?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      })),
      cursor: items.length > 0 ? items[items.length - 1]!.id : null,
      hasNext,
    };
  }

  /**
   * Get a single API key by ID (org-scoped).
   */
  async findOne(organizationId: string, id: string) {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        permissions: true,
        rateLimitPerMinute: true,
        isActive: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
        organizationId: true,
      },
    });

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    return {
      ...apiKey,
      permissions: apiKey.permissions as string[],
      lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
      expiresAt: apiKey.expiresAt?.toISOString() ?? null,
      createdAt: apiKey.createdAt.toISOString(),
      updatedAt: apiKey.updatedAt.toISOString(),
    };
  }

  /**
   * Update an API key (org-scoped).
   */
  async update(organizationId: string, id: string, dto: UpdateApiKeyDto) {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundException('API key not found');
    }

    if (dto.permissions) {
      const invalid = dto.permissions.filter(
        (p) => !VALID_PERMISSIONS.includes(p),
      );
      if (invalid.length > 0) {
        throw new BadRequestException(
          `Invalid permissions: ${invalid.join(', ')}`,
        );
      }
    }

    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: {
        ...(dto.name != null && { name: dto.name }),
        ...(dto.permissions != null && { permissions: dto.permissions }),
        ...(dto.rateLimitPerMinute != null && {
          rateLimitPerMinute: dto.rateLimitPerMinute,
        }),
        ...(dto.isActive != null && { isActive: dto.isActive }),
        ...(dto.expiresAt !== undefined && {
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        }),
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        permissions: true,
        rateLimitPerMinute: true,
        isActive: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
        organizationId: true,
      },
    });

    return {
      ...updated,
      permissions: updated.permissions as string[],
      lastUsedAt: updated.lastUsedAt?.toISOString() ?? null,
      expiresAt: updated.expiresAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Delete an API key (org-scoped). Hard delete.
   */
  async remove(organizationId: string, id: string) {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundException('API key not found');
    }

    await this.prisma.apiKey.delete({ where: { id } });
    this.logger.log(
      `API key deleted: ${id} (${existing.keyPrefix}...) from org ${organizationId}`,
    );
  }
}
