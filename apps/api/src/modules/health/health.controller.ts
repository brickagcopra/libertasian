import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  check() {
    return this.healthService.check();
  }
}
