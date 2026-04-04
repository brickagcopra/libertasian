import { AppThrottlerGuard } from './app-throttler.guard';

describe('AppThrottlerGuard', () => {
  let guard: AppThrottlerGuard;

  beforeEach(() => {
    // AppThrottlerGuard extends ThrottlerGuard which requires DI deps.
    // We only test the overridden getTracker method.
    guard = Object.create(AppThrottlerGuard.prototype);
  });

  describe('getTracker', () => {
    it('should return userId when authenticated user is present', async () => {
      const req = {
        user: { sub: 'user-123' },
        ip: '192.168.1.1',
      };
      const result = await guard['getTracker'](req);
      expect(result).toBe('user-123');
    });

    it('should return IP address when user is not present', async () => {
      const req = {
        ip: '10.0.0.1',
      };
      const result = await guard['getTracker'](req);
      expect(result).toBe('10.0.0.1');
    });

    it('should return IP when user exists but has no sub', async () => {
      const req = {
        user: {},
        ip: '172.16.0.1',
      };
      const result = await guard['getTracker'](req);
      expect(result).toBe('172.16.0.1');
    });

    it('should return "unknown" when neither user nor IP is available', async () => {
      const req = {};
      const result = await guard['getTracker'](req);
      expect(result).toBe('unknown');
    });

    it('should return IP when user is undefined', async () => {
      const req = {
        user: undefined,
        ip: '8.8.8.8',
      };
      const result = await guard['getTracker'](req);
      expect(result).toBe('8.8.8.8');
    });

    it('should return IP when user is null', async () => {
      const req = {
        user: null,
        ip: '1.1.1.1',
      };
      const result = await guard['getTracker'](req);
      expect(result).toBe('1.1.1.1');
    });

    it('should prefer userId over IP address', async () => {
      const req = {
        user: { sub: 'user-abc' },
        ip: '192.168.0.100',
      };
      const result = await guard['getTracker'](req);
      expect(result).toBe('user-abc');
    });
  });
});
