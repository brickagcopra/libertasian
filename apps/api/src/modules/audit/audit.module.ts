import { Global, Module } from '@nestjs/common';

import { AdminBypassAuditService } from '../../common/services/admin-bypass-audit.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AdminBypassAuditService],
  exports: [AuditService, AdminBypassAuditService],
})
export class AuditModule {}
