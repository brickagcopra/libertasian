import { Linking, Platform } from 'react-native';

import {
  STORE_ACCOUNT_HOSTS,
  isStoreAccountUrl,
  openStoreAccountPage,
} from '@/lib/store-account-page';

describe('isStoreAccountUrl', () => {
  it('accepts https pages on the two store hosts', () => {
    expect(isStoreAccountUrl('https://apps.apple.com/account/subscriptions')).toBe(true);
    expect(
      isStoreAccountUrl(
        'https://play.google.com/store/account/subscriptions?sku=com.libertasian.edu.annual&package=com.libertasian.app',
      ),
    ).toBe(true);
  });

  it.each([
    ['http, not https', 'http://play.google.com/store/account/subscriptions'],
    ['our own site', 'https://libertasian.com/pricing'],
    ['a look-alike suffix', 'https://play.google.com.evil.example/x'],
    ['a look-alike prefix', 'https://notplay.google.com/x'],
    ['userinfo smuggling', 'https://play.google.com@evil.example/x'],
    ['a port', 'https://play.google.com:8443/x'],
    ['another scheme', 'javascript:alert(1)'],
    ['empty', ''],
  ])('refuses %s', (_label, url) => {
    expect(isStoreAccountUrl(url)).toBe(false);
  });

  it('pins the host list to the two stores', () => {
    expect([...STORE_ACCOUNT_HOSTS].sort()).toEqual(['apps.apple.com', 'play.google.com']);
  });
});

describe('openStoreAccountPage', () => {
  const openURL = jest.spyOn(Linking, 'openURL');
  const originalOS = Platform.OS;

  beforeEach(() => {
    openURL.mockReset().mockResolvedValue(undefined);
  });
  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS });
  });

  it('opens the store URL it was given', async () => {
    const url = 'https://play.google.com/store/account/subscriptions?package=com.libertasian.app';
    await expect(openStoreAccountPage(url)).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith(url);
  });

  it("replaces a non-store URL with the platform's own store page", async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    await openStoreAccountPage('https://libertasian.com/billing');
    expect(openURL).toHaveBeenCalledWith('https://play.google.com/store/account/subscriptions');
  });

  it('reports false when the OS refuses', async () => {
    openURL.mockRejectedValueOnce(new Error('no handler'));
    await expect(openStoreAccountPage(null)).resolves.toBe(false);
  });
});
