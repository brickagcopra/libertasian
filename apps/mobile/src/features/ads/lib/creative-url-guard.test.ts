import { Linking } from 'react-native';
import {
  isPurchaseUrl,
  isCreativeAllowed,
  openCreativeUrl,
} from './creative-url-guard';

/**
 * Ad creatives are server-authored and can change after this binary has
 * shipped and been reviewed. A creative pointing at a pricing page or a
 * checkout would put a live build in violation of Apple 3.1.1 / Play
 * Payments with no fix short of a new submission.
 *
 * Prod has zero `ad_creatives` rows today, so these tests are the only thing
 * standing between "nothing violates" and "nothing can violate".
 */
describe('creative-url-guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isPurchaseUrl — refuses', () => {
    const blocked = [
      'https://libertasian.com/pricing',
      'https://libertasian.com/pricing/',
      'https://libertasian.com/pricing.html',
      'https://libertasian.com/settings/billing',
      'https://libertasian.com/checkout',
      'https://libertasian.com/plans',
      'https://libertasian.com/subscribe',
      'https://libertasian.com/upgrade',
      'https://example.com/buy/now',
      'https://example.com/store',
      'https://example.com/cart',
      'https://example.com/payment/confirm',
      'https://example.com/donate',
      // Purchase-only hosts, any path.
      'https://checkout.xendit.co/web/session-1',
      'https://xendit.co/anything',
      'https://checkout.stripe.com/pay/cs_test',
      'https://www.paypal.com/checkoutnow',
      // Redirect-style query smuggling.
      'https://example.com/go?to=/pricing',
      'https://example.com/r?plan=pro',
      // Non-http schemes could deep-link straight into a purchase flow.
      'libertasian://settings/plans',
      'itms-apps://apps.apple.com/account/subscriptions',
      // Unparseable → fail closed.
      'not a url',
      '//pricing',
    ];

    for (const url of blocked) {
      it(`blocks ${url}`, () => {
        expect(isPurchaseUrl(url)).toBe(true);
      });
    }
  });

  describe('isPurchaseUrl — allows', () => {
    const allowed = [
      'https://libertasian.com',
      'https://libertasian.com/blog/how-we-built-the-corpus',
      'https://libertasian.com/bar-exams/2022',
      'https://lawschool.example.ph/admissions',
      'https://example.com/webinar?utm_source=libertasian',
      // "priced" is not the segment "price"; whole-segment matching matters or
      // the deny list swallows ordinary editorial URLs.
      'https://libertasian.com/blog/how-we-priced-the-corpus',
      'https://libertasian.com/enterprise-plans-explained',
    ];

    for (const url of allowed) {
      it(`allows ${url}`, () => {
        expect(isPurchaseUrl(url)).toBe(false);
      });
    }

    it('treats a missing URL as nothing to open, not a violation', () => {
      expect(isPurchaseUrl(null)).toBe(false);
      expect(isPurchaseUrl(undefined)).toBe(false);
      expect(isPurchaseUrl('')).toBe(false);
    });
  });

  describe('isCreativeAllowed', () => {
    it('suppresses a creative whose CTA is a purchase', () => {
      expect(isCreativeAllowed({ ctaUrl: 'https://libertasian.com/pricing' })).toBe(
        false,
      );
    });

    it('permits an ordinary creative', () => {
      expect(
        isCreativeAllowed({ ctaUrl: 'https://libertasian.com/blog/hello' }),
      ).toBe(true);
    });

    it('permits a creative with no CTA at all', () => {
      expect(isCreativeAllowed({ ctaUrl: null })).toBe(true);
    });
  });

  describe('openCreativeUrl', () => {
    it('opens an ordinary https URL', () => {
      expect(openCreativeUrl('https://libertasian.com/blog/hello')).toBe(true);
      expect(Linking.openURL).toHaveBeenCalledWith(
        'https://libertasian.com/blog/hello',
      );
    });

    it('refuses a purchase URL without touching Linking', () => {
      expect(openCreativeUrl('https://libertasian.com/pricing')).toBe(false);
      expect(Linking.openURL).not.toHaveBeenCalled();
    });

    it('refuses a checkout host without touching Linking', () => {
      expect(openCreativeUrl('https://checkout.xendit.co/web/session-1')).toBe(
        false,
      );
      expect(Linking.openURL).not.toHaveBeenCalled();
    });

    it('refuses a non-http scheme', () => {
      expect(openCreativeUrl('libertasian://settings/plans')).toBe(false);
      expect(Linking.openURL).not.toHaveBeenCalled();
    });

    it('does nothing for a missing URL', () => {
      expect(openCreativeUrl(null)).toBe(false);
      expect(Linking.openURL).not.toHaveBeenCalled();
    });
  });
});
