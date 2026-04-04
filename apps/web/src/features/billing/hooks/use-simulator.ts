'use client';

import { useMutation } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  SimulateTransitionInput,
  SimulateTransitionResult,
  SimulateLifecycleInput,
  SimulateLifecycleResult,
  SimulatePricingInput,
  SimulatePricingResult,
  SimulateProrationInput,
  SimulateProrationResult,
  SimulateCouponInput,
  SimulateCouponResult,
  SimulatePromotionInput,
  SimulatePromotionResult,
  SimulateRevenueImpactInput,
  SimulateRevenueImpactResult,
  SimulatorResponse,
} from '../types';

export function useSimulateTransition() {
  return useMutation({
    mutationFn: async (input: SimulateTransitionInput): Promise<SimulateTransitionResult> => {
      const res = await apiClient.post<SimulatorResponse<SimulateTransitionResult>>(
        '/admin/simulator/transition',
        input,
      );
      return res.data;
    },
  });
}

export function useSimulateLifecycle() {
  return useMutation({
    mutationFn: async (input: SimulateLifecycleInput): Promise<SimulateLifecycleResult> => {
      const res = await apiClient.post<SimulatorResponse<SimulateLifecycleResult>>(
        '/admin/simulator/lifecycle',
        input,
      );
      return res.data;
    },
  });
}

export function useSimulatePricing() {
  return useMutation({
    mutationFn: async (input: SimulatePricingInput): Promise<SimulatePricingResult> => {
      const res = await apiClient.post<SimulatorResponse<SimulatePricingResult>>(
        '/admin/simulator/pricing',
        input,
      );
      return res.data;
    },
  });
}

export function useSimulateProration() {
  return useMutation({
    mutationFn: async (input: SimulateProrationInput): Promise<SimulateProrationResult> => {
      const res = await apiClient.post<SimulatorResponse<SimulateProrationResult>>(
        '/admin/simulator/proration',
        input,
      );
      return res.data;
    },
  });
}

export function useSimulateCoupon() {
  return useMutation({
    mutationFn: async (input: SimulateCouponInput): Promise<SimulateCouponResult> => {
      const res = await apiClient.post<SimulatorResponse<SimulateCouponResult>>(
        '/admin/simulator/coupon',
        input,
      );
      return res.data;
    },
  });
}

export function useSimulatePromotion() {
  return useMutation({
    mutationFn: async (input: SimulatePromotionInput): Promise<SimulatePromotionResult> => {
      const res = await apiClient.post<SimulatorResponse<SimulatePromotionResult>>(
        '/admin/simulator/promotion',
        input,
      );
      return res.data;
    },
  });
}

export function useSimulateRevenueImpact() {
  return useMutation({
    mutationFn: async (input: SimulateRevenueImpactInput): Promise<SimulateRevenueImpactResult> => {
      const res = await apiClient.post<SimulatorResponse<SimulateRevenueImpactResult>>(
        '/admin/simulator/revenue-impact',
        input,
      );
      return res.data;
    },
  });
}
