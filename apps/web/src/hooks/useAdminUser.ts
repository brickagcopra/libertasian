'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { adminUsersKeys } from './useAdminUsers';

export interface AdminUserMembership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: string;
  status: string;
  joinedAt: string;
}

export interface AdminUserSubscription {
  id: string;
  organizationId: string;
  organizationName: string;
  planCode: string;
  planName: string | null;
  status: string;
  billingPeriod: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  createdAt: string;
}

export interface AdminUserPayment {
  id: string;
  organizationId: string;
  amount: number;
  currency: string;
  status: string;
  paymentType: string;
  paidAt: string | null;
  xenditInvoiceId: string;
}

export interface AdminUserCouponRedemption {
  id: string;
  couponCode: string;
  discountAmountApplied: number | null;
  redeemedAt: string | null;
  status: string;
}

export interface AdminUserPromotionRedemption {
  id: string;
  promotionName: string;
  promotionSlug: string;
  discountAmountApplied: number | null;
  status: string;
  createdAt: string;
}

export interface AdminUserComplimentaryAccess {
  id: string;
  organizationId: string;
  planCode: string;
  reason: string;
  startsAt: string;
  endsAt: string | null;
  status: string;
}

export interface AdminUserEntitlementOverride {
  id: string;
  organizationId: string;
  entitlementKey: string;
  overrideType: string;
  numericValue: number | null;
  booleanValue: boolean | null;
  reason: string;
  startsAt: string;
  expiresAt: string | null;
  isActive: boolean;
}

export interface AdminUserExpertVerification {
  expertiseType: string;
  status: string;
  reviewedAt: string | null;
  createdAt: string;
}

export interface AdminUserEmailPreferences {
  transactional: boolean;
  subscriptionUpdates: boolean;
  announcements: boolean;
  blogNotifications: boolean;
}

export interface AdminUserLoginEvent {
  id: string;
  eventType: string;
  ipAddress: string | null;
  userAgent: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  failureReason: string | null;
  createdAt: string;
}

export interface AdminUserDetail {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  userRole: string | null;
  onboardingCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  signupSource: 'google' | 'password';
  memberships: AdminUserMembership[];
  subscriptions: AdminUserSubscription[];
  payments: AdminUserPayment[];
  couponRedemptions: AdminUserCouponRedemption[];
  promotionRedemptions: AdminUserPromotionRedemption[];
  complimentaryAccess: AdminUserComplimentaryAccess[];
  entitlementOverrides: AdminUserEntitlementOverride[];
  expertVerification: AdminUserExpertVerification | null;
  emailPreferences: AdminUserEmailPreferences | null;
  lastLoginAt: string | null;
  lastLoginCountry: string | null;
  lastLoginIp: string | null;
  loginHistory: AdminUserLoginEvent[];
}

export interface AdminUserDetailResponse {
  success: boolean;
  data: AdminUserDetail;
}

export function useAdminUser(id: string | null) {
  return useQuery({
    queryKey: id ? adminUsersKeys.detail(id) : ['admin', 'users', 'detail', 'idle'],
    queryFn: async () => {
      const res = await apiClient.get<AdminUserDetailResponse>(`/admin/users/${id}`);
      return res.data;
    },
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}
