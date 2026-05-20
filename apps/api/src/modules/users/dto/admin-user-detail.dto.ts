import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminUserOrgMembershipDto {
  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  organizationName!: string;

  @ApiProperty()
  organizationSlug!: string;

  @ApiProperty()
  role!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ description: 'Org membership createdAt (joinedAt)' })
  joinedAt!: Date;
}

export class AdminUserSubscriptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  organizationName!: string;

  @ApiProperty()
  planCode!: string;

  @ApiPropertyOptional()
  planName!: string | null;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  billingPeriod!: string;

  @ApiPropertyOptional()
  currentPeriodStart!: Date | null;

  @ApiPropertyOptional()
  currentPeriodEnd!: Date | null;

  @ApiPropertyOptional()
  trialStart!: Date | null;

  @ApiPropertyOptional()
  trialEnd!: Date | null;

  @ApiProperty()
  cancelAtPeriodEnd!: boolean;

  @ApiPropertyOptional()
  canceledAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

export class AdminUserPaymentDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  paymentType!: string;

  @ApiPropertyOptional()
  paidAt!: Date | null;

  @ApiProperty()
  xenditInvoiceId!: string;
}

export class AdminUserCouponRedemptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  couponCode!: string;

  @ApiPropertyOptional()
  discountAmountApplied!: number | null;

  @ApiPropertyOptional()
  redeemedAt!: Date | null;

  @ApiProperty()
  status!: string;
}

export class AdminUserPromotionRedemptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  promotionName!: string;

  @ApiProperty()
  promotionSlug!: string;

  @ApiPropertyOptional()
  discountAmountApplied!: number | null;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  createdAt!: Date;
}

export class AdminUserComplimentaryAccessDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  planCode!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty()
  startsAt!: Date;

  @ApiPropertyOptional()
  endsAt!: Date | null;

  @ApiProperty()
  status!: string;
}

export class AdminUserEntitlementOverrideDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  entitlementKey!: string;

  @ApiProperty()
  overrideType!: string;

  @ApiPropertyOptional()
  numericValue!: number | null;

  @ApiPropertyOptional()
  booleanValue!: boolean | null;

  @ApiProperty()
  reason!: string;

  @ApiProperty()
  startsAt!: Date;

  @ApiPropertyOptional()
  expiresAt!: Date | null;

  @ApiProperty()
  isActive!: boolean;
}

export class AdminUserExpertVerificationDto {
  @ApiProperty()
  expertiseType!: string;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional()
  reviewedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

export class AdminUserEmailPreferencesDto {
  @ApiProperty()
  transactional!: boolean;

  @ApiProperty()
  subscriptionUpdates!: boolean;

  @ApiProperty()
  announcements!: boolean;

  @ApiProperty()
  blogNotifications!: boolean;
}

export class AdminUserLoginEventDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'login_success | login_failed | google_login | token_refresh | logout | password_reset_used | mfa_challenge_passed | mfa_challenge_failed' })
  eventType!: string;

  @ApiPropertyOptional()
  ipAddress!: string | null;

  @ApiPropertyOptional()
  userAgent!: string | null;

  @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2 country code' })
  country!: string | null;

  @ApiPropertyOptional()
  region!: string | null;

  @ApiPropertyOptional()
  city!: string | null;

  @ApiPropertyOptional()
  failureReason!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

export class AdminUserDetailDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  fullName!: string;

  @ApiPropertyOptional()
  phone!: string | null;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  emailVerified!: boolean;

  @ApiProperty()
  mfaEnabled!: boolean;

  @ApiPropertyOptional()
  userRole!: string | null;

  @ApiPropertyOptional()
  onboardingCompletedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty({ description: 'Signup source: "google" if linked to Google, otherwise "password"' })
  signupSource!: 'google' | 'password';

  @ApiProperty({ type: [AdminUserOrgMembershipDto] })
  memberships!: AdminUserOrgMembershipDto[];

  @ApiProperty({ type: [AdminUserSubscriptionDto] })
  subscriptions!: AdminUserSubscriptionDto[];

  @ApiProperty({ type: [AdminUserPaymentDto] })
  payments!: AdminUserPaymentDto[];

  @ApiProperty({ type: [AdminUserCouponRedemptionDto] })
  couponRedemptions!: AdminUserCouponRedemptionDto[];

  @ApiProperty({ type: [AdminUserPromotionRedemptionDto] })
  promotionRedemptions!: AdminUserPromotionRedemptionDto[];

  @ApiProperty({ type: [AdminUserComplimentaryAccessDto] })
  complimentaryAccess!: AdminUserComplimentaryAccessDto[];

  @ApiProperty({ type: [AdminUserEntitlementOverrideDto] })
  entitlementOverrides!: AdminUserEntitlementOverrideDto[];

  @ApiPropertyOptional({ type: AdminUserExpertVerificationDto })
  expertVerification!: AdminUserExpertVerificationDto | null;

  @ApiPropertyOptional({ type: AdminUserEmailPreferencesDto })
  emailPreferences!: AdminUserEmailPreferencesDto | null;

  @ApiPropertyOptional({ description: 'Most recent successful login timestamp' })
  lastLoginAt!: Date | null;

  @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2 country code from last login IP' })
  lastLoginCountry!: string | null;

  @ApiPropertyOptional({ description: 'City geo-resolved from last login IP' })
  lastLoginCity!: string | null;

  @ApiPropertyOptional({ description: 'Region/state geo-resolved from last login IP' })
  lastLoginRegion!: string | null;

  @ApiPropertyOptional({ description: 'IP address of last successful login' })
  lastLoginIp!: string | null;

  @ApiProperty({ type: [AdminUserLoginEventDto], description: 'Last 20 login events, newest first' })
  loginHistory!: AdminUserLoginEventDto[];
}

export class AdminUserDetailResponseDto {
  @ApiProperty()
  success!: boolean;

  @ApiProperty({ type: AdminUserDetailDto })
  data!: AdminUserDetailDto;
}
