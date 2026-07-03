import {
  describePaymentMethod,
  formatBillingDate,
  formatPhpAmount,
} from './notification-format.util';

describe('notification-format.util', () => {
  describe('formatBillingDate', () => {
    it('renders dates in Philippine time, not server UTC', () => {
      // 2026-07-06T22:00:00Z is already July 7 in Asia/Manila (UTC+8).
      expect(formatBillingDate(new Date('2026-07-06T22:00:00Z'))).toBe(
        'July 7, 2026',
      );
    });

    it('keeps the same calendar day when UTC and PH agree', () => {
      expect(formatBillingDate(new Date('2026-07-06T04:00:00Z'))).toBe(
        'July 6, 2026',
      );
    });
  });

  describe('formatPhpAmount', () => {
    it('formats centavos with thousands separator and two decimals', () => {
      expect(formatPhpAmount(199900)).toBe('1,999.00');
    });
  });

  describe('describePaymentMethod', () => {
    it('labels a card with brand and last4', () => {
      expect(
        describePaymentMethod({ type: 'card', brand: 'Visa', last4: '4242' }),
      ).toBe('Visa •••• 4242');
    });

    it('falls back to a generic label when no method is stored', () => {
      expect(describePaymentMethod(null)).toBe('your saved payment method');
    });
  });
});
