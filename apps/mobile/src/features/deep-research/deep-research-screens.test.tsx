import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { apiClient } from '../../lib/api-client';
import { HomeScreen } from '../../components/screens/HomeScreen';
import { setSurfaceAccess } from '../entitlements/test-helpers';
import { resolveDeepResearchAccess } from './access';
import { RunResult } from './components/run-result';
import { DeepResearchTile, GoDeeperChip } from './components/entry-points';
import RunView from './components/run-view';
import { __resetConsumedRunTokens } from './hooks/use-deep-research-stream';
import { streamDeepResearch } from './stream-deep-research';
import type { DeepResearchEvent } from './types';
import type { QuotaUsageData } from '../billing/types';

import ResearchIndexRoute from '../../app/research/index';

jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false },
    Redirect: ({ href }: { href: string }) => <Text testID="redirect">{String(href)}</Text>,
    Stack: Object.assign(({ children }: { children?: React.ReactNode }) => children ?? null, {
      Screen: () => null,
    }),
    useLocalSearchParams: () => ({}),
  };
});

jest.mock('../../lib/api-client', () => {
  const actual = jest.requireActual('../../lib/api-client');
  return { ...actual, apiClient: { get: jest.fn(), delete: jest.fn() } };
});

jest.mock('./stream-deep-research', () => ({
  ...jest.requireActual('./stream-deep-research'),
  streamDeepResearch: jest.fn(),
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPush = router.push as jest.Mock;
const mockStream = streamDeepResearch as jest.MockedFunction<typeof streamDeepResearch>;

const ALL = { scan: true, study: true, barExams: true, digestGeneration: true, workspace: true };
const NONE = { scan: false, study: false, barExams: false, digestGeneration: false, workspace: false };

function quotaResponse(item: { used: number; limit: number } | null): QuotaUsageData {
  return {
    quotas: item
      ? {
          deepResearchPerMonth: {
            ...item,
            allowed: item.limit !== 0 && item.used < item.limit,
            remaining: Math.max(0, item.limit - item.used),
            resetsAt: '2026-10-01T12:00:00.000Z',
            baseLimit: item.limit,
            bonusAmount: 0,
          },
        }
      : {},
    billingPeriodStart: null,
    billingPeriodEnd: null,
    activeBonuses: [],
    previewOnly: false,
    storePurchaseAvailable: false,
  };
}

function routeApi(quota: ReturnType<typeof quotaResponse>) {
  mockGet.mockImplementation(async (endpoint: string) => {
    if (endpoint === '/quotas/usage') return quota as never;
    if (endpoint === '/deep-research') {
      return {
        success: true,
        data: [
          {
            id: 'run-1',
            question: 'What is laches?',
            status: 'completed',
            createdAt: '2026-09-01T00:00:00.000Z',
          },
        ],
        meta: { nextCursor: null, hasMore: false },
      } as never;
    }
    throw new Error(`unexpected GET ${endpoint}`);
  });
}

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetConsumedRunTokens();
});

// ─── Entitlement states ────────────────────────────────────────────────────

describe('entitlement states on /research', () => {
  it('iOS free (store purchase live): the purchase entry point, and no paid query fires', () => {
    setSurfaceAccess({ surfaces: ALL, entitled: false, storePurchaseAvailable: true });
    routeApi(quotaResponse({ used: 0, limit: 0 }));

    renderWithClient(<ResearchIndexRoute />);

    expect(screen.getByText(/every claim checked against its quote/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('purchase-entry-point'));
    expect(mockPush).toHaveBeenCalledWith('/purchase');
    expect(mockGet).not.toHaveBeenCalledWith('/deep-research', expect.anything());
    expect(screen.queryByTestId('deep-research-composer')).toBeNull();
  });

  it('Android free (no store): the route redirects home and entry points render nothing', () => {
    setSurfaceAccess({ surfaces: NONE, entitled: false, storePurchaseAvailable: false });

    renderWithClient(<ResearchIndexRoute />);
    expect(screen.getByTestId('redirect')).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();

    renderWithClient(
      <>
        <GoDeeperChip query="estoppel" />
        <DeepResearchTile />
      </>,
    );
    expect(screen.queryByTestId('go-deeper-chip')).toBeNull();
    expect(screen.queryByTestId('deep-research-tile')).toBeNull();
  });

  it('entitled but a limit of 0 on a platform with no store: the neutral refusal, no button', async () => {
    setSurfaceAccess({ surfaces: ALL, entitled: true, storePurchaseAvailable: false });
    routeApi(quotaResponse({ used: 0, limit: 0 }));

    renderWithClient(<ResearchIndexRoute />);

    expect(await screen.findByTestId('entitlement-refusal')).toBeTruthy();
    expect(screen.getByText("This isn't available right now.")).toBeTruthy();
    expect(screen.queryByTestId('deep-research-submit')).toBeNull();
  });

  it('entitled but a limit of 0 where a store is live: the purchase entry point', async () => {
    setSurfaceAccess({ surfaces: ALL, entitled: true, storePurchaseAvailable: true });
    routeApi(quotaResponse({ used: 0, limit: 0 }));

    renderWithClient(<ResearchIndexRoute />);
    expect(await screen.findByTestId('purchase-entry-point')).toBeTruthy();
  });

  it('pro: quota chip, history, and a Research button that starts a run', async () => {
    setSurfaceAccess({ surfaces: ALL, entitled: true, storePurchaseAvailable: false });
    routeApi(quotaResponse({ used: 3, limit: 20 }));

    renderWithClient(<ResearchIndexRoute />);

    expect(await screen.findByText('17 of 20 left this month')).toBeTruthy();
    expect(await screen.findByText('What is laches?')).toBeTruthy();

    // No button until the question is long enough — a hint, not a dead button.
    expect(screen.queryByTestId('deep-research-submit')).toBeNull();
    fireEvent.changeText(screen.getByTestId('deep-research-input'), 'Is estoppel a defense?');
    fireEvent.press(screen.getByTestId('deep-research-submit'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/research/[id]',
      params: expect.objectContaining({ id: 'new', q: 'Is estoppel a defense?', t: expect.any(String) }),
    });
  });

  it('exhausted: the reset date in place of the button', async () => {
    setSurfaceAccess({ surfaces: ALL, entitled: true, storePurchaseAvailable: false });
    routeApi(quotaResponse({ used: 20, limit: 20 }));

    renderWithClient(<ResearchIndexRoute />);

    expect(await screen.findByTestId('deep-research-exhausted')).toBeTruthy();
    expect(screen.getByText(/They reset on Oct 1\./)).toBeTruthy();
    expect(screen.queryByTestId('deep-research-submit')).toBeNull();
    expect(screen.queryByTestId('deep-research-input')).toBeNull();
  });

  it('swipe-to-delete row: the delete action confirms before deleting', async () => {
    setSurfaceAccess({ surfaces: ALL, entitled: true, storePurchaseAvailable: false });
    routeApi(quotaResponse({ used: 3, limit: 20 }));
    const { Alert } = require('react-native');

    renderWithClient(<ResearchIndexRoute />);
    fireEvent.press(await screen.findByTestId('deep-research-delete-run-1'));
    expect(Alert.alert).toHaveBeenCalledWith('Delete this run?', expect.any(String), expect.any(Array));

    fireEvent.press(screen.getByTestId('deep-research-run-run-1'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/research/[id]', params: { id: 'run-1' } });
  });
});

describe('resolveDeepResearchAccess', () => {
  const entitled = { surfaces: ALL, entitled: true, storePurchaseAvailable: false };

  it('reads unlimited (-1) as ready, unlimited', () => {
    expect(resolveDeepResearchAccess(entitled, quotaResponse({ used: 5, limit: -1 }), false)).toMatchObject({
      kind: 'ready',
      unlimited: true,
    });
  });

  it('lets the server decide when the quota read failed or the key is absent', () => {
    expect(resolveDeepResearchAccess(entitled, undefined, true).kind).toBe('ready');
    expect(resolveDeepResearchAccess(entitled, quotaResponse(null), false).kind).toBe('ready');
    expect(resolveDeepResearchAccess(entitled, undefined, false).kind).toBe('loading');
  });
});

// ─── Run view outcomes ─────────────────────────────────────────────────────

function streamEmits(events: DeepResearchEvent[]) {
  mockStream.mockImplementation(async (_req, onEvent) => {
    events.forEach(onEvent);
  });
}

describe('run view outcomes', () => {
  beforeEach(() => {
    setSurfaceAccess({ surfaces: ALL, entitled: true, storePurchaseAvailable: false });
  });

  it('quota_exceeded from the stream shows the reset date', async () => {
    streamEmits([
      { type: 'error', data: { code: 'quota_exceeded', message: '', resetAt: '2026-10-01T12:00:00.000Z' } },
    ]);
    renderWithClient(<RunView mode="live" question="Q about laches" token="t1" />);
    expect(await screen.findByText(/They reset on Oct 1\./)).toBeTruthy();
  });

  it('subscription_required from the stream shows the refusal', async () => {
    streamEmits([{ type: 'error', data: { code: 'subscription_required', message: 'x' } }]);
    renderWithClient(<RunView mode="live" question="Q about laches" token="t2" />);
    expect(await screen.findByTestId('entitlement-refusal')).toBeTruthy();
  });

  it('budget_exhausted and abstained get friendly cards', async () => {
    streamEmits([{ type: 'error', data: { code: 'budget_exhausted', message: 'x' } }]);
    renderWithClient(<RunView mode="live" question="Q about laches" token="t3" />);
    expect(await screen.findByTestId('deep-research-budget')).toBeTruthy();

    streamEmits([
      {
        type: 'result',
        data: { summary: '', sections: [], removedClaims: 0, abstained: true, abstainReason: 'no_results' },
      },
    ]);
    renderWithClient(<RunView mode="live" question="Another question" token="t4" />);
    expect(await screen.findByTestId('deep-research-abstained')).toBeTruthy();
    expect(screen.getByText(/No sources matched this question/)).toBeTruthy();
  });

  it('starts exactly one run per token, even across a remount', async () => {
    streamEmits([]);
    const first = renderWithClient(<RunView mode="live" question="Q about laches" token="same" />);
    first.unmount();
    renderWithClient(<RunView mode="live" question="Q about laches" token="same" />);
    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('deep-research-already-started')).toBeTruthy();
  });
});

// ─── Citation sheet ────────────────────────────────────────────────────────

const SOURCES = [
  {
    sourceId: 'S1',
    documentId: 'doc-1',
    sectionId: 'sec-9',
    title: 'People v. Cruz',
    citation: 'G.R. No. 123456',
    grNo: '123456',
    court: 'supreme_court',
    date: '2020-01-15',
    sectionLabel: 'Ruling',
    documentType: 'decision',
  },
  {
    sourceId: 'S2',
    documentId: 'doc-2',
    sectionId: null,
    title: 'Civil Code, Art. 1431',
    citation: null,
    grNo: null,
    court: null,
    date: null,
    sectionLabel: null,
    documentType: 'statute',
  },
];

const RESULT = {
  summary: 'Estoppel bars a party from denying its own representation.',
  sections: [
    {
      heading: 'The rule',
      claims: [
        {
          text: 'Estoppel is a bar.',
          citations: [
            { sourceId: 'S2', quote: 'Through estoppel an admission is rendered conclusive' },
            { sourceId: 'S1', quote: 'the doctrine of estoppel is based on public policy' },
            { sourceId: 'GHOST', quote: 'not in the sources list' },
          ],
        },
      ],
    },
  ],
  removedClaims: 3,
  abstained: false,
};

describe('citations', () => {
  it('numbers chips by source order and drops citations to unknown sources', () => {
    render(<RunResult result={RESULT} sources={SOURCES} />);
    expect(screen.getByTestId('citation-chip-1')).toBeTruthy();
    expect(screen.getByTestId('citation-chip-2')).toBeTruthy();
    expect(screen.queryByTestId('citation-chip-3')).toBeNull();
    expect(screen.getByText('3 unsupported statements removed during verification.')).toBeTruthy();
    expect(screen.getByText('Sources (2)')).toBeTruthy();
    expect(screen.getByText(/generated by AI/)).toBeTruthy();
  });

  it('opens the sheet with the verbatim quote, title, citation, court and date', () => {
    render(<RunResult result={RESULT} sources={SOURCES} />);
    fireEvent.press(screen.getByTestId('citation-chip-1'));

    expect(screen.getByTestId('citation-quote').props.children).toBe(
      '“the doctrine of estoppel is based on public policy”',
    );
    expect(screen.getAllByText('People v. Cruz').length).toBeGreaterThan(0);
    expect(screen.getAllByText('G.R. No. 123456').length).toBeGreaterThan(0);
    expect(screen.getByText('supreme court')).toBeTruthy();
    expect(screen.getByText('Jan 15, 2020')).toBeTruthy();
  });

  it('"Open in reader" lands on the document and section', () => {
    render(<RunResult result={RESULT} sources={SOURCES} />);
    fireEvent.press(screen.getByTestId('citation-chip-1'));
    fireEvent.press(screen.getByTestId('citation-open-reader'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/reader/[id]',
      params: { id: 'doc-1', section: 'sec-9' },
    });
  });

  it('a sectionless source opens the document only', () => {
    render(<RunResult result={RESULT} sources={SOURCES} />);
    fireEvent.press(screen.getByTestId('citation-chip-2'));
    fireEvent.press(screen.getByTestId('citation-open-reader'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/reader/[id]', params: { id: 'doc-2' } });
  });

  it('Share sends plain text with numbered citations', async () => {
    const { Share } = require('react-native');
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    streamEmits([
      { type: 'sources', data: { sources: SOURCES } },
      { type: 'result', data: RESULT },
      {
        type: 'done',
        data: { runId: 'r', modelName: null, promptTemplateVersion: null, latencyMs: 1, costUsd: 0 },
      },
    ]);
    renderWithClient(<RunView mode="live" question="What is estoppel?" token="share" />);
    await act(async () => {
      fireEvent.press(await screen.findByTestId('deep-research-share'));
    });
    const message = (share.mock.calls[0]![0] as { message: string }).message;
    expect(message).toContain('Deep Research: What is estoppel?');
    expect(message).toContain('- Estoppel is a bar. [1][2]');
    expect(message).toContain('[1] People v. Cruz — G.R. No. 123456 · supreme court · Jan 15, 2020');
    share.mockRestore();
  });

  it('Follow-up starts a new run carrying the original question', async () => {
    streamEmits([
      { type: 'sources', data: { sources: SOURCES } },
      { type: 'result', data: RESULT },
      {
        type: 'done',
        data: { runId: 'r', modelName: null, promptTemplateVersion: null, latencyMs: 1, costUsd: 0 },
      },
    ]);
    renderWithClient(<RunView mode="live" question="What is estoppel?" token="follow" />);
    fireEvent.press(await screen.findByTestId('deep-research-follow-up'));
    fireEvent.changeText(screen.getByTestId('deep-research-follow-up-input'), 'Does it apply to the State?');
    fireEvent.press(screen.getByTestId('deep-research-follow-up-submit'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/research/[id]',
      params: expect.objectContaining({
        id: 'new',
        q: 'Follow-up to "What is estoppel?": Does it apply to the State?',
      }),
    });
  });
});

// ─── Entry points ──────────────────────────────────────────────────────────

describe('entry-point navigation', () => {
  beforeEach(() => {
    setSurfaceAccess({ surfaces: ALL, entitled: true, storePurchaseAvailable: false });
  });

  it('Search "Go deeper" carries the query into the composer', () => {
    render(<GoDeeperChip query="  estoppel against the State " />);
    fireEvent.press(screen.getByTestId('go-deeper-chip'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/research',
      params: { q: 'estoppel against the State' },
    });
  });

  it('Workspace tile opens Deep Research', () => {
    render(<DeepResearchTile />);
    fireEvent.press(screen.getByTestId('deep-research-tile'));
    expect(mockPush).toHaveBeenCalledWith('/research');
  });

  it('Home card renders only when wired, and calls through', () => {
    const onPress = jest.fn();
    const { rerender } = render(<HomeScreen feed={[]} onDeepResearchPress={onPress} />);
    fireEvent.press(screen.getByTestId('home-deep-research-card'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Verified multi-source answers')).toBeTruthy();

    rerender(<HomeScreen feed={[]} />);
    expect(screen.queryByTestId('home-deep-research-card')).toBeNull();
  });

  it('the composer is pre-filled from ?q=', async () => {
    const expoRouter = require('expo-router');
    const spy = jest.spyOn(expoRouter, 'useLocalSearchParams').mockReturnValue({ q: 'estoppel' });
    routeApi(quotaResponse({ used: 0, limit: 5 }));
    renderWithClient(<ResearchIndexRoute />);
    await waitFor(() => expect(screen.getByTestId('deep-research-input').props.value).toBe('estoppel'));
    spy.mockRestore();
  });
});
