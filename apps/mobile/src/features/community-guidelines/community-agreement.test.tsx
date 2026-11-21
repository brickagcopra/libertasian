jest.unmock('./community-agreement');

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

const mockStore = new Map<string, unknown>();

jest.mock('../../storage/mmkv', () => ({
  STORAGE_KEYS: { COMMUNITY_GUIDELINES_ACCEPTED: 'community_guidelines_accepted' },
  mmkvStorage: {
    getBoolean: (k: string) => mockStore.get(k) as boolean | undefined,
    setBoolean: (k: string, v: boolean) => mockStore.set(k, v),
    delete: (k: string) => mockStore.delete(k),
  },
}));

jest.mock('@/providers/theme-provider', () => ({
  useTheme: () => ({
    theme: {
      surface: '#fff',
      ink: '#000',
      inkSoft: '#333',
      accent: '#00f',
      accentInk: '#fff',
      serif: undefined,
      sans: undefined,
      radius: 8,
    },
  }),
}));

import {
  answerCommunityAgreement,
  getCommunityAgreementSnapshot,
  hasCommunityAgreement,
  requestCommunityAgreement,
  setCommunityAgreement,
} from './community-agreement';
import { CommunityAgreementHost } from './community-agreement-host';

beforeEach(() => {
  mockStore.clear();
  setCommunityAgreement(false);
  jest.clearAllMocks();
});

describe('community agreement gate', () => {
  it('resolves true at once when already accepted', async () => {
    setCommunityAgreement(true);
    await expect(requestCommunityAgreement()).resolves.toBe(true);
    expect(getCommunityAgreementSnapshot().prompting).toBe(false);
  });

  it('prompts once for concurrent callers and persists an acceptance', async () => {
    const a = requestCommunityAgreement();
    const b = requestCommunityAgreement();
    expect(a).toBe(b);
    expect(getCommunityAgreementSnapshot().prompting).toBe(true);
    answerCommunityAgreement(true);
    await expect(a).resolves.toBe(true);
    expect(getCommunityAgreementSnapshot()).toEqual({ accepted: true, prompting: false });
    expect(mockStore.get('community_guidelines_accepted')).toBe(true);
  });

  it('does not remember "Cancel" and asks again on the next submit', async () => {
    const first = requestCommunityAgreement();
    answerCommunityAgreement(false);
    await expect(first).resolves.toBe(false);
    expect(hasCommunityAgreement()).toBe(false);
    expect(mockStore.has('community_guidelines_accepted')).toBe(false);
    void requestCommunityAgreement();
    expect(getCommunityAgreementSnapshot().prompting).toBe(true);
    answerCommunityAgreement(false);
  });

  it('notices an acceptance cleared by an account switch', () => {
    setCommunityAgreement(true);
    mockStore.delete('community_guidelines_accepted');
    expect(hasCommunityAgreement()).toBe(false);
    expect(getCommunityAgreementSnapshot().accepted).toBe(false);
  });
});

describe('CommunityAgreementHost', () => {
  it('shows the guidelines while a submit waits, and "I agree" resolves true', async () => {
    const { getByText, queryByText } = render(<CommunityAgreementHost />);
    expect(queryByText('I agree')).toBeNull();

    let pending!: Promise<boolean>;
    act(() => {
      pending = requestCommunityAgreement();
    });
    expect(getByText('Community Guidelines')).toBeTruthy();
    expect(getByText(/zero tolerance for objectionable content/)).toBeTruthy();
    expect(getByText(/suspended or banned/)).toBeTruthy();
    expect(getByText(/report any post, comment or community item, and block any user/)).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText('I agree'));
    });
    await expect(pending).resolves.toBe(true);
    expect(hasCommunityAgreement()).toBe(true);
    expect(queryByText('I agree')).toBeNull();
  });

  it('"Cancel" resolves false and stores nothing', async () => {
    const { getByText } = render(<CommunityAgreementHost />);
    let pending!: Promise<boolean>;
    act(() => {
      pending = requestCommunityAgreement();
    });
    await act(async () => {
      fireEvent.press(getByText('Cancel'));
    });
    await expect(pending).resolves.toBe(false);
    expect(mockStore.has('community_guidelines_accepted')).toBe(false);
  });

  it('the Terms of Use link cancels this submit and opens the Terms screen', async () => {
    const { getByText } = render(<CommunityAgreementHost />);
    let pending!: Promise<boolean>;
    act(() => {
      pending = requestCommunityAgreement();
    });
    await act(async () => {
      fireEvent.press(getByText('Terms of Use'));
    });
    await expect(pending).resolves.toBe(false);
    expect(router.push).toHaveBeenCalledWith('/purchase/terms');
  });
});
