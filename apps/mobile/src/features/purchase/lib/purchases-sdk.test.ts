import { subscriptionOrigin } from './purchases-sdk';

const info = (...stores: string[]) =>
  ({
    entitlements: {
      active: Object.fromEntries(stores.map((store, i) => [`e${i}`, { store }])),
    },
  }) as never;

describe('subscriptionOrigin', () => {
  it('is null when nothing is active', () => {
    expect(subscriptionOrigin(info(), 'ios')).toBeNull();
    expect(subscriptionOrigin(null, 'android')).toBeNull();
  });

  it.each([
    ['ios', 'APP_STORE'],
    ['ios', 'MAC_APP_STORE'],
    ['android', 'PLAY_STORE'],
  ])('is this_store on %s for %s', (platform, store) => {
    expect(subscriptionOrigin(info(store), platform)).toBe('this_store');
  });

  it.each([
    ['ios', 'PLAY_STORE'],
    ['android', 'APP_STORE'],
    ['ios', 'PROMOTIONAL'],
    ['web', 'APP_STORE'],
  ])('is elsewhere on %s for %s', (platform, store) => {
    expect(subscriptionOrigin(info(store), platform)).toBe('elsewhere');
  });

  it('prefers this_store when the account holds both', () => {
    expect(subscriptionOrigin(info('PLAY_STORE', 'APP_STORE'), 'ios')).toBe('this_store');
  });
});
