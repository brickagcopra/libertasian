import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import * as fs from 'fs';

import { AdminAnnouncementsController } from './admin-announcements.controller';
import { EmailProcessor } from './email.processor';
import { EmailService } from './email.service';
import { EmailUnsubscribeController } from './email-unsubscribe.controller';
import { NotificationsService } from './notifications.service';
import { NotificationCenterService } from './notification-center.service';
import { NotificationCenterController } from './notification-center.controller';
import { NotificationListener } from './notification.listener';
import { NotificationsGateway } from './notifications.gateway';
import { PushService } from './push.service';
import { PushTokensController } from './push-tokens.controller';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: 'emails' }),
    ConfigModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const privateKeyPath = config.get<string>('JWT_PRIVATE_KEY_PATH', '');
        const privateKeyEnv = config.get<string>('JWT_PRIVATE_KEY', '');
        const jwtSecret = config.get<string>('JWT_SECRET', '');

        if (privateKeyPath && fs.existsSync(privateKeyPath)) {
          const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
          return {
            privateKey,
            signOptions: { algorithm: 'RS256' as const },
          };
        }

        if (privateKeyEnv) {
          const privateKey = Buffer.from(privateKeyEnv, 'base64').toString('utf8');
          return {
            privateKey,
            signOptions: { algorithm: 'RS256' as const },
          };
        }

        return {
          secret: jwtSecret || 'dev-secret-change-in-production',
        };
      },
    }),
  ],
  // PushTokensController must precede NotificationCenterController so
  // DELETE /notifications/push-tokens is not captured by DELETE /notifications/:id.
  controllers: [PushTokensController, NotificationCenterController, EmailUnsubscribeController, AdminAnnouncementsController],
  providers: [
    EmailService,
    EmailProcessor,
    NotificationsService,
    NotificationCenterService,
    NotificationListener,
    NotificationsGateway,
    PushService,
  ],
  exports: [NotificationsService, NotificationCenterService, NotificationsGateway, PushService],
})
export class NotificationsModule {}
