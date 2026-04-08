import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SiteContentService {
  private readonly logger = new Logger(SiteContentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByKey(key: string) {
    const record = await this.prisma.siteContent.findUnique({
      where: { key },
    });

    if (!record) {
      throw new NotFoundException(`Site content not found for key: ${key}`);
    }

    return record;
  }

  async upsert(key: string, content: Record<string, unknown>, userId: string) {
    const existing = await this.prisma.siteContent.findUnique({
      where: { key },
    });

    if (existing) {
      const updated = await this.prisma.siteContent.update({
        where: { key },
        data: {
          content: content as object,
          version: existing.version + 1,
          updatedBy: userId,
        },
      });
      this.logger.log(`Site content updated: key=${key}, version=${updated.version}`);
      return updated;
    }

    const created = await this.prisma.siteContent.create({
      data: {
        key,
        content: content as object,
        version: 1,
        updatedBy: userId,
      },
    });
    this.logger.log(`Site content created: key=${key}`);
    return created;
  }

  async deleteByKey(key: string) {
    const existing = await this.prisma.siteContent.findUnique({
      where: { key },
    });

    if (!existing) {
      throw new NotFoundException(`Site content not found for key: ${key}`);
    }

    await this.prisma.siteContent.delete({ where: { key } });
    this.logger.log(`Site content deleted: key=${key}`);
  }
}
