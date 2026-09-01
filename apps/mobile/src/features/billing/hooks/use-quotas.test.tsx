import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { apiClient } from '../../../lib/api-client';
import { storage, STORAGE_KEYS } from '../../../storage/mmkv';
import { useFreemiumSurfacesSync } from '../../entitlements/use-freemium-surfaces';
import type { QuotaUsageData } from '../types';
import { useQuotaUsage } from './use-quotas';

/**
 * THE ENVELOPE IS STRIPPED ONCE, BY `apiClient`. Not twice.
 *
 * `apiClient.get()` runs `unwrapEnvelope`, which returns `payload.data` whenever
 * the body's only keys are `success` / `data` / `message`. `GET /quotas/usage`
 * returns exactly `{ success, data }` with no `meta` sibling, so the hook's
 * generic describes the ALREADY-UNWRAPPED payload and a second `.data` reads a
 * field that does not exist.
 *
 * That returned `undefined`, and `undefined` is indistinguishable from "the
 * request has not resolved yet" to every consumer: `useFreemiumSurfacesSync`
 * early-returns on it, never writes MMKV, and `useSurfaceAccess()` falls back to
 * NO_ACCESS — hiding all five paid surfaces AND the purchase row.
 *
 * WHY IT SURVIVED: `use-freemium-surfaces.test.tsx` mocks `useQuotaUsage`
 * wholesale and hands it a well-formed object, so it proves the consumer
 * behaves given good data and says nothing about whether the hook produces it.
 * These tests mock ONE layer lower — at `apiClient`, the real seam — so the
 * unwrapping itself is under test.
 */

const UNWRAPPED: QuotaUsageData = {
  quotas: {
    aiAnswers: {
      allowed: true,
      used: 0,
      limit: 50,
      remaining: 50,
      resetsAt: '',
      baseLimit: 50,
      bonusAmount: 0,
    },
  },
  billingPeriodStart: null,
  billingPeriodEnd: null,
  activeBonuses: [],
  previewOnly: false,
  storePurchaseAvailable: true,
};

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe('useQuotaUsage — envelope unwrapping', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    storage.delete(STORAGE_KEYS.ENTITLED_SURFACES);
  });

  it('returns the payload apiClient already unwrapped, not undefined', async () => {
    // apiClient returns the UNWRAPPED body, because unwrapEnvelope already ran.
    jest.spyOn(apiClient, 'get').mockResolvedValue(UNWRAPPED as never);

    const { result } = renderHook(() => useQuotaUsage(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The regression, stated as the thing that actually broke: this field is
    // what gates the purchase row, and it was `undefined` because the hook read
    // `.data` off an object that has no `.data`.
    expect(result.current.data).toBeDefined();
    expect(result.current.data?.storePurchaseAvailable).toBe(true);
    expect(result.current.data?.previewOnly).toBe(false);
    expect(result.current.data?.quotas.aiAnswers?.limit).toBe(50);
  });

  it('does not double-unwrap — the whole payload survives', async () => {
    jest.spyOn(apiClient, 'get').mockResolvedValue(UNWRAPPED as never);

    const { result } = renderHook(() => useQuotaUsage(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Pins the shape rather than one field: reading `.data` again would make
    // every one of these undefined at once.
    expect(result.current.data).toEqual(UNWRAPPED);
  });

  it('requests the right path and passes `enabled` through', async () => {
    const get = jest.spyOn(apiClient, 'get').mockResolvedValue(UNWRAPPED as never);

    const { result } = renderHook(() => useQuotaUsage(false), {
      wrapper: wrapper(),
    });

    // Disabled is what `useFreemiumSurfacesSync` uses while signed out; it must
    // not fire the request at all.
    expect(get).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});

describe('useFreemiumSurfacesSync — writes MMKV for a real response', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    storage.delete(STORAGE_KEYS.ENTITLED_SURFACES);
  });

  it('persists the surface blob end to end, from apiClient to MMKV', async () => {
    jest.spyOn(apiClient, 'get').mockResolvedValue(UNWRAPPED as never);

    // The real `useQuotaUsage` runs here — no mock between the two hooks, which
    // is the seam the bug lived in.
    renderHook(() => useFreemiumSurfacesSync(true), { wrapper: wrapper() });

    await waitFor(() => {
      expect(storage.getString(STORAGE_KEYS.ENTITLED_SURFACES)).toBeDefined();
    });

    const blob = JSON.parse(
      storage.getString(STORAGE_KEYS.ENTITLED_SURFACES) as string,
    );

    // `previewOnly: false` means entitled, so every surface is visible, and
    // `storePurchaseAvailable` carries through to the purchase row's gate.
    expect(blob).toEqual({
      scan: true,
      study: true,
      barExams: true,
      digestGeneration: true,
      workspace: true,
      entitled: true,
      storePurchaseAvailable: true,
    });
  });

  it('writes storePurchaseAvailable false when the server says so', async () => {
    jest
      .spyOn(apiClient, 'get')
      .mockResolvedValue({ ...UNWRAPPED, storePurchaseAvailable: false } as never);

    renderHook(() => useFreemiumSurfacesSync(true), { wrapper: wrapper() });

    await waitFor(() => {
      expect(storage.getString(STORAGE_KEYS.ENTITLED_SURFACES)).toBeDefined();
    });

    const blob = JSON.parse(
      storage.getString(STORAGE_KEYS.ENTITLED_SURFACES) as string,
    );
    expect(blob.storePurchaseAvailable).toBe(false);
  });
});
