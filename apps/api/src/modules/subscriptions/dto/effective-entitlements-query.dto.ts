import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The platform to resolve entitlements AS.
 *
 * 'web' is the wire spelling of the `null` platform the resolver uses for any
 * client with no in-app store — web, and every mobile build shipped before the
 * `x-platform` header landed. It is the default because it is what a client
 * that sends no header gets.
 */
export enum EffectiveEntitlementsPlatform {
  WEB = 'web',
  IOS = 'ios',
  ANDROID = 'android',
}

export class EffectiveEntitlementsQueryDto {
  @ApiPropertyOptional({
    enum: EffectiveEntitlementsPlatform,
    default: EffectiveEntitlementsPlatform.WEB,
    description:
      'Resolve as a client on this platform. Entitlements are platform-dependent: ' +
      'a purchase-capable iOS build is gated where web is not.',
  })
  @IsOptional()
  @IsEnum(EffectiveEntitlementsPlatform)
  platform?: EffectiveEntitlementsPlatform;
}
