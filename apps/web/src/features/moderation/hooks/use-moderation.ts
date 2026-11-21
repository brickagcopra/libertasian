'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  AppealStatus,
  BulkResolveInput,
  BulkResolveResult,
  CreateSanctionInput,
  DecideAppealInput,
  ModerationAppeal,
  CursorMeta,
  ModerationActionEntry,
  ModerationAuthorProfile,
  ModerationCaseDetail,
  ModerationCasesMeta,
  ModerationCasesQuery,
  ModerationCaseSummary,
  ModerationSanction,
  ModerationStats,
  ModerationTargetType,
  ResolveCaseInput,
  RestoreContentInput,
  RevokeSanctionInput,
} from '../types';

interface Envelope<T> {
  success: boolean;
  data: T;
}

interface MetaEnvelope<T, M> extends Envelope<T> {
  meta?: M;
}

const BASE = '/admin/moderation';
const REFETCH_MS = 60_000;
const CURSOR_PAGE_SIZE = 25;

/** Every moderation query sits under this prefix; mutations invalidate it whole. */
export const moderationKeys = {
  all: ['admin', 'moderation'] as const,
  stats: () => [...moderationKeys.all, 'stats'] as const,
  cases: (query: ModerationCasesQuery) => [...moderationKeys.all, 'cases', query] as const,
  case: (targetType: string, targetId: string) =>
    [...moderationKeys.all, 'case', targetType, targetId] as const,
  user: (userId: string) => [...moderationKeys.all, 'user', userId] as const,
  sanctions: (active: boolean) => [...moderationKeys.all, 'sanctions', active] as const,
  log: () => [...moderationKeys.all, 'log'] as const,
  appeals: (status: AppealStatus) => [...moderationKeys.all, 'appeals', status] as const,
};

export interface CasesPage {
  data: ModerationCaseSummary[];
  meta: ModerationCasesMeta;
}

export interface CursorPage<T> {
  data: T[];
  meta: CursorMeta;
}

function casesParams(query: ModerationCasesQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.status) params['status'] = query.status;
  if (query.type) params['type'] = query.type;
  if (query.sort) params['sort'] = query.sort;
  if (query.limit !== undefined) params['limit'] = String(query.limit);
  if (query.offset !== undefined) params['offset'] = String(query.offset);
  return params;
}

function caseUrl(targetType: string, targetId: string): string {
  return `${BASE}/cases/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`;
}

// ---- Fetchers (exported for envelope tests) ----

export async function fetchModerationStats(): Promise<ModerationStats> {
  const res = await apiClient.get<Envelope<ModerationStats>>(`${BASE}/stats`);
  return res.data;
}

export async function fetchModerationCases(query: ModerationCasesQuery): Promise<CasesPage> {
  const res = await apiClient.get<MetaEnvelope<ModerationCaseSummary[], ModerationCasesMeta>>(
    `${BASE}/cases`,
    { params: casesParams(query) },
  );
  return { data: res.data, meta: res.meta ?? { total: res.data.length, hasNext: false } };
}

export async function fetchModerationCase(
  targetType: string,
  targetId: string,
): Promise<ModerationCaseDetail> {
  const res = await apiClient.get<Envelope<ModerationCaseDetail>>(caseUrl(targetType, targetId));
  return res.data;
}

export async function fetchModerationUser(userId: string): Promise<ModerationAuthorProfile> {
  const res = await apiClient.get<Envelope<ModerationAuthorProfile>>(
    `${BASE}/users/${encodeURIComponent(userId)}`,
  );
  return res.data;
}

async function fetchCursorPage<T>(
  path: string,
  extra: Record<string, string>,
  cursor: string | undefined,
): Promise<CursorPage<T>> {
  const params: Record<string, string> = { ...extra, limit: String(CURSOR_PAGE_SIZE) };
  if (cursor) params['cursor'] = cursor;
  const res = await apiClient.get<MetaEnvelope<T[], CursorMeta>>(path, { params });
  return { data: res.data, meta: res.meta ?? { hasNext: false, nextCursor: null } };
}

export function fetchModerationSanctions(
  active: boolean,
  cursor?: string,
): Promise<CursorPage<ModerationSanction>> {
  return fetchCursorPage<ModerationSanction>(
    `${BASE}/sanctions`,
    { active: String(active) },
    cursor,
  );
}

export function fetchModerationLog(cursor?: string): Promise<CursorPage<ModerationActionEntry>> {
  return fetchCursorPage<ModerationActionEntry>(`${BASE}/log`, {}, cursor);
}

export function fetchModerationAppeals(
  status: AppealStatus,
  cursor?: string,
): Promise<CursorPage<ModerationAppeal>> {
  return fetchCursorPage<ModerationAppeal>(`${BASE}/appeals`, { status }, cursor);
}

// ---- Queries ----

export function useModerationAppeals(status: AppealStatus) {
  return useInfiniteQuery({
    queryKey: moderationKeys.appeals(status),
    queryFn: ({ pageParam }) => fetchModerationAppeals(status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.meta.hasNext && last.meta.nextCursor ? last.meta.nextCursor : undefined,
  });
}

export function useModerationStats() {
  return useQuery({
    queryKey: moderationKeys.stats(),
    queryFn: fetchModerationStats,
    refetchInterval: REFETCH_MS,
  });
}

export function useModerationCases(query: ModerationCasesQuery) {
  return useQuery({
    queryKey: moderationKeys.cases(query),
    queryFn: () => fetchModerationCases(query),
    refetchInterval: REFETCH_MS,
    placeholderData: keepPreviousData,
  });
}

export function useModerationCase(targetType: string, targetId: string) {
  return useQuery({
    queryKey: moderationKeys.case(targetType, targetId),
    queryFn: () => fetchModerationCase(targetType, targetId),
    enabled: !!targetType && !!targetId,
  });
}

export function useModerationUser(userId: string | null | undefined) {
  return useQuery({
    queryKey: moderationKeys.user(userId ?? ''),
    queryFn: () => fetchModerationUser(userId ?? ''),
    enabled: !!userId,
  });
}

/** `active = true` lists only sanctions currently restricting a user. */
export function useModerationSanctions(active: boolean) {
  return useInfiniteQuery({
    queryKey: moderationKeys.sanctions(active),
    queryFn: ({ pageParam }) => fetchModerationSanctions(active, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.meta.hasNext && last.meta.nextCursor ? last.meta.nextCursor : undefined,
  });
}

export function useModerationLog() {
  return useInfiniteQuery({
    queryKey: moderationKeys.log(),
    queryFn: ({ pageParam }) => fetchModerationLog(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.meta.hasNext && last.meta.nextCursor ? last.meta.nextCursor : undefined,
  });
}

// ---- Mutations ----

function useInvalidateModeration() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: moderationKeys.all });
}

export interface CaseTarget {
  targetType: ModerationTargetType;
  targetId: string;
}

export function useResolveCase() {
  const invalidate = useInvalidateModeration();
  return useMutation({
    mutationFn: async ({ targetType, targetId, input }: CaseTarget & { input: ResolveCaseInput }) => {
      const res = await apiClient.post<Envelope<ModerationCaseDetail>>(
        `${caseUrl(targetType, targetId)}/resolve`,
        input,
      );
      return res.data;
    },
    onSuccess: () => invalidate(),
  });
}

export function useRestoreContent() {
  const invalidate = useInvalidateModeration();
  return useMutation({
    mutationFn: async ({
      targetType,
      targetId,
      input,
    }: CaseTarget & { input: RestoreContentInput }) => {
      const res = await apiClient.post<Envelope<ModerationCaseDetail>>(
        `${BASE}/content/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}/restore`,
        input,
      );
      return res.data;
    },
    onSuccess: () => invalidate(),
  });
}

export function useCreateSanction() {
  const invalidate = useInvalidateModeration();
  return useMutation({
    mutationFn: async ({ userId, input }: { userId: string; input: CreateSanctionInput }) => {
      const res = await apiClient.post<Envelope<ModerationSanction>>(
        `${BASE}/users/${encodeURIComponent(userId)}/sanctions`,
        input,
      );
      return res.data;
    },
    onSuccess: () => invalidate(),
  });
}

export function useRevokeSanction() {
  const invalidate = useInvalidateModeration();
  return useMutation({
    mutationFn: async ({ sanctionId, input }: { sanctionId: string; input: RevokeSanctionInput }) => {
      const res = await apiClient.post<Envelope<ModerationSanction>>(
        `${BASE}/sanctions/${encodeURIComponent(sanctionId)}/revoke`,
        input,
      );
      return res.data;
    },
    onSuccess: () => invalidate(),
  });
}

export function useBulkResolve() {
  const invalidate = useInvalidateModeration();
  return useMutation({
    mutationFn: async (input: BulkResolveInput) => {
      const res = await apiClient.post<Envelope<BulkResolveResult>>(`${BASE}/cases/bulk-resolve`, input);
      return res.data;
    },
    onSuccess: () => invalidate(),
  });
}

export function useDecideAppeal() {
  const invalidate = useInvalidateModeration();
  return useMutation({
    mutationFn: async ({ appealId, input }: { appealId: string; input: DecideAppealInput }) => {
      const res = await apiClient.post<Envelope<ModerationAppeal>>(
        `${BASE}/appeals/${encodeURIComponent(appealId)}/decide`,
        input,
      );
      return res.data;
    },
    onSuccess: () => invalidate(),
  });
}
