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
});
