import { Injectable } from '@nestjs/common';
import type { HealthCheckResponse } from '@libertasian/types';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthCheckResponse> {
    const services: HealthCheckResponse['services'] = {};

    // Check database
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      services['database'] = { status: 'up', latencyMs: Date.now() - start };
    } catch {
      services['database'] = { status: 'down', message: 'Database connection failed' };
    }

    const allUp = Object.values(services).every((s) => s.status === 'up');

    return {
      status: allUp ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      services,
    };
  }
}
