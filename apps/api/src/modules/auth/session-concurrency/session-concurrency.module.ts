import { Global, Module } from '@nestjs/common';

import { SessionConcurrencyService } from './session-concurrency.service';

/**
 * Global so JwtAuthGuard — instantiated in every module that lists it in
 * @UseGuards — can inject the service without each module importing it.
 * Its own dependencies (RedisService, SubscriptionsService, ConfigService)
 * are global as well.
 */
@Global()
@Module({
  providers: [SessionConcurrencyService],
  exports: [SessionConcurrencyService],
})
export class SessionConcurrencyModule {}
