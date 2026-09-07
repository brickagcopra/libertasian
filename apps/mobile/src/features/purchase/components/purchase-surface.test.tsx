import { readFileSync } from 'fs';
import { join } from 'path';

import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '@/providers/theme-provider';

import type { PurchasePlanOption } from '../products';
import { PurchaseSurface } from './purchase-surface';

const PLANS: PurchasePlanOption[] = [
  {
    productId: 'com.libertasian.pro.monthly',
    title: 'LIBERTASIAN Pro',
    duration: '1 month',
    priceString: '₱1,699.00',
  },
  {
    productId: 'com.libertasian.pro.annual',
    title: 'LIBERTASIAN Pro',
    duration: '1 year',
    priceString: '₱16,990.00',
  },
  {
    productId: 'com.libertasian.edu.monthly',
    title: 'LIBERTASIAN Edu',
    duration: '1 month',
    priceString: '₱499.00',
  },
];

function renderSurface(props: Partial<React.ComponentProps<typeof PurchaseSurface>> = {}) {
  const handlers = {
    onPurchase: jest.fn(),
    onRestore: jest.fn(),
    onRetry: jest.fn(),
    onOpenTerms: jest.fn(),
    onOpenPrivacy: jest.fn(),
  };
  render(
    <ThemeProvider>
      <PurchaseSurface status="ready" plans={PLANS} {...handlers} {...props} />
    </ThemeProvider>,
  );
  return handlers;
}

describe('PurchaseSurface', () => {
  it('shows title, duration and price for every option (3.1.2(c))', () => {
    // All three must be in front of the customer BEFORE they subscribe. This is
    // the requirement the whole D13 exemption exists to make room for, so it is
    // asserted per-plan rather than spot-checked.
    renderSurface();

    for (const plan of PLANS) {
      expect(screen.getByLabelText(
        `${plan.title}, ${plan.duration}, ${plan.priceString}`,
      )).toBeTruthy();
    }
  });

  it('renders the price string exactly as the store gave it', () => {
    // No reformatting, no symbol of our own, no rounding. The store's string is
    // already localized for the viewer's storefront; anything we did to it
    // would be wrong somewhere.
    renderSurface();
    expect(screen.getByText('₱1,699.00')).toBeTruthy();
    expect(screen.getByText('₱16,990.00')).toBeTruthy();
    expect(screen.getByText('₱499.00')).toBeTruthy();
  });

  it('offers Restore Purchases even with nothing to restore', () => {
    // Guideline 3.1.1 requires a restore mechanism, and App Review tests it
    // from an account holding nothing — which is exactly this state.
    const handlers = renderSurface({ status: 'unavailable', plans: [] });

    fireEvent.press(screen.getByText('Restore Purchases'));
    expect(handlers.onRestore).toHaveBeenCalledTimes(1);
  });

  it('purchases the selected product id and nothing else', () => {
    const handlers = renderSurface();

    fireEvent.press(screen.getByLabelText('LIBERTASIAN Edu, 1 month, ₱499.00'));
    fireEvent.press(screen.getByText('Continue'));

    expect(handlers.onPurchase).toHaveBeenCalledWith('com.libertasian.edu.monthly');
    expect(handlers.onPurchase).toHaveBeenCalledTimes(1);
  });

  it('defaults the selection to the first option so Continue is never ambiguous', () => {
    const handlers = renderSurface();

    fireEvent.press(screen.getByText('Continue'));

    expect(handlers.onPurchase).toHaveBeenCalledWith('com.libertasian.pro.monthly');
  });

  it('cannot purchase when the store gave us no options', () => {
    // A disabled Continue is the point: with no offering there is no price on
    // screen, and a purchase started without a price shown is the 3.1.2(c)
    // violation this component exists to prevent.
    const handlers = renderSurface({ status: 'unavailable', plans: [] });

    fireEvent.press(screen.getByText('Continue'));
    expect(handlers.onPurchase).not.toHaveBeenCalled();
  });

  it('blocks both actions while one is in flight', () => {
    const handlers = renderSurface({ busy: true });

    fireEvent.press(screen.getByText('Restore Purchases'));
    expect(handlers.onRestore).not.toHaveBeenCalled();
    expect(handlers.onPurchase).not.toHaveBeenCalled();
  });

  it('links Terms and Privacy to in-app screens, not out of the app', () => {
    const handlers = renderSurface();

    fireEvent.press(screen.getByText('Terms of Use'));
    fireEvent.press(screen.getByText('Privacy Policy'));

    expect(handlers.onOpenTerms).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenPrivacy).toHaveBeenCalledTimes(1);
  });

  it('shows a neutral notice without implying failure', () => {
    renderSurface({ notice: 'We could not confirm that yet. Try Restore Purchases.' });
    expect(
      screen.getByText('We could not confirm that yet. Try Restore Purchases.'),
    ).toBeTruthy();
  });

  // ---- the unavailable state is no longer terminal ----

  /**
   * THE 2.1(b) SHAPE. The sentence stays — it is the one line that covers every
   * store-side reason without explaining how to subscribe some other way — but
   * it used to be all there was. The offering result was cached as a success
   * for five minutes, so a user reading it had no action that could change it.
   * App Review read that as a purchase screen that does not work.
   */
  it('keeps its sentence and adds a way out', () => {
    const handlers = renderSurface({ status: 'unavailable', plans: [] });

    expect(
      screen.getByText('Plans are not available right now. Please try again later.'),
    ).toBeTruthy();

    fireEvent.press(screen.getByText('Try again'));
    expect(handlers.onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers no way out when there is nothing wrong', () => {
    renderSurface();
    expect(screen.queryByText('Try again')).toBeNull();

    renderSurface({ status: 'loading', plans: [] });
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('blocks the retry while a purchase or restore is in flight', () => {
    const handlers = renderSurface({ status: 'unavailable', plans: [], busy: true });

    fireEvent.press(screen.getByText('Try again'));
    expect(handlers.onRetry).not.toHaveBeenCalled();
  });

  /**
   * Guideline 3.1.1 — what got build 23 rejected. The way out must ask the
   * STORE again, on this screen. A URL, a `Linking` call, or any off-app route
   * added here would put another way to subscribe on the one screen that may
   * not have one.
   */
  it('sends the user nowhere: no URL, no Linking, no off-app route', () => {
    // Comments must be free to NAME the rule they are enforcing, so they are
    // stripped first — exactly as `no-purchase-copy.test.ts` does. What is left
    // is code, which is what could actually take a user out of the app.
    const source = readFileSync(join(__dirname, 'purchase-surface.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/\bLinking\b/);
    expect(source).not.toMatch(/libertasian\.com/);
    expect(source).not.toMatch(/openURL|WebBrowser/);
  });
});
