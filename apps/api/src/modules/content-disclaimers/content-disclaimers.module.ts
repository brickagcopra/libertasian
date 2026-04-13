import { Global, Module } from '@nestjs/common';

import { ContentDisclaimersService } from './content-disclaimers.service';

/**
 * Global provider for `ContentDisclaimersService`. Marked `@Global()` so
 * that the APP_INTERCEPTOR-registered `AttachDisclaimerInterceptor` can
 * inject the service without every domain module having to import this
 * module explicitly. The service also participates in the module init
 * lifecycle, so the in-memory cache is warm before any HTTP handler runs.
 */
@Global()
@Module({
  providers: [ContentDisclaimersService],
  exports: [ContentDisclaimersService],
})
export class ContentDisclaimersModule {}
