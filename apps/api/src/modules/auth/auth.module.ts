import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import * as fs from 'fs';

import { OrganizationsModule } from '../organizations/organizations.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginEventService } from './login-event.service';
import { LoginThrottleService } from './login-throttle.service';
import { SocialTokenService } from './social-token.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * Conditionally provide GoogleStrategy only when GOOGLE_CLIENT_ID is configured.
 * This prevents passport from registering a non-functional Google strategy.
 */
const googleStrategyProvider = {
  provide: 'GOOGLE_STRATEGY',
  inject: [ConfigService],
  useFactory: (config: ConfigService): GoogleStrategy | null => {
    const clientId = config.get<string>('GOOGLE_CLIENT_ID', '');
    if (clientId) {
      return new GoogleStrategy(config);
    }
    return null;
  },
};

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const privateKeyPath = config.get<string>('JWT_PRIVATE_KEY_PATH', '');
        const privateKeyEnv = config.get<string>('JWT_PRIVATE_KEY', '');
        const jwtSecret = config.get<string>('JWT_SECRET', '');

        // RS256 via file path
        if (privateKeyPath && fs.existsSync(privateKeyPath)) {
          const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
          return {
            privateKey,
            signOptions: { algorithm: 'RS256' as const },
          };
        }

        // RS256 via base64-encoded env var
        if (privateKeyEnv) {
          const privateKey = Buffer.from(privateKeyEnv, 'base64').toString('utf8');
          return {
            privateKey,
            signOptions: { algorithm: 'RS256' as const },
          };
        }

        // Fallback: symmetric HMAC (development only)
        return {
          secret: jwtSecret || 'dev-secret-change-in-production',
        };
      },
    }),
    OrganizationsModule,
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginEventService,
    LoginThrottleService,
    SocialTokenService,
    JwtStrategy,
    GoogleStrategy,
  ],
  exports: [AuthService, LoginEventService],
})
export class AuthModule {}
