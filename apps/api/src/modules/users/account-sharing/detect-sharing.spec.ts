import { assessSharing, haversineKm, placeOf, type SharingEvent } from './detect-sharing';

const MANILA = { country: 'PH', region: 'NCR', city: 'Manila', latitude: 14.5995, longitude: 120.9842 };
const QC = { country: 'PH', region: 'NCR', city: 'Quezon City', latitude: 14.676, longitude: 121.0437 };
const CEBU = { country: 'PH', region: 'Central Visayas', city: 'Cebu City', latitude: 10.3157, longitude: 123.8854 };
const DAVAO = { country: 'PH', region: 'Davao', city: 'Davao City', latitude: 7.1907, longitude: 125.4553 };
const SINGAPORE = { country: 'SG', region: '01', city: 'Singapore', latitude: 1.3521, longitude: 103.8198 };

const at = (iso: string, place: Omit<SharingEvent, 'createdAt'>): SharingEvent => ({
  createdAt: new Date(iso),
  ...place,
});

describe('placeOf', () => {
  it('falls back city -> region -> country and treats blanks as unknown', () => {
    expect(placeOf({ country: 'PH', region: 'NCR', city: 'Manila' })).toBe('Manila, PH');
    expect(placeOf({ country: 'US', region: 'CT', city: '' })).toBe('CT, US');
    expect(placeOf({ country: 'FR', region: '', city: '' })).toBe('FR');
    expect(placeOf({ country: null, region: null, city: '  ' })).toBeNull();
  });
});

describe('haversineKm', () => {
  it('is about 2,390 km from Manila to Singapore', () => {
    const km = haversineKm(MANILA.latitude, MANILA.longitude, SINGAPORE.latitude, SINGAPORE.longitude);
    expect(km).toBeGreaterThan(2350);
    expect(km).toBeLessThan(2430);
  });
});

describe('assessSharing', () => {
  it('does not flag one person moving around Metro Manila', () => {
    const r = assessSharing([
      at('2026-11-22T01:00:00Z', MANILA),
      at('2026-11-22T02:00:00Z', QC),
      at('2026-11-22T03:00:00Z', MANILA),
    ]);
    expect(r.flagged).toBe(false);
    expect(r.places).toEqual(['Manila, PH', 'Quezon City, PH']);
  });

  it('does not count blank-city rows as extra places', () => {
    const blankUs = { country: 'US', region: '', city: '', latitude: 37.751, longitude: -97.822 };
    const r = assessSharing([
      at('2026-11-22T01:00:00Z', blankUs),
      at('2026-11-22T05:00:00Z', blankUs),
    ]);
    expect(r.places).toEqual(['US']);
  });

  it('flags four distinct places in the window', () => {
    const r = assessSharing([
      at('2026-11-22T01:00:00Z', MANILA),
      at('2026-11-22T06:00:00Z', CEBU),
      at('2026-11-22T12:00:00Z', DAVAO),
      at('2026-11-22T20:00:00Z', QC),
    ]);
    expect(r.reasons).toContain('many_places');
    // 5-6 hours between the hops: a flight, not impossible travel.
    expect(r.jumps).toEqual([]);
  });

  it('flags impossible travel: Manila then Singapore 30 minutes later', () => {
    const r = assessSharing([
      at('2026-11-22T01:00:00Z', MANILA),
      at('2026-11-22T01:30:00Z', SINGAPORE),
    ]);
    expect(r.flagged).toBe(true);
    expect(r.reasons).toEqual(['impossible_travel']);
    expect(r.jumps[0]).toMatchObject({ from: 'Manila, PH', to: 'Singapore, SG', minutes: 30 });
  });

  it('accepts the same trip at flight speed', () => {
    const r = assessSharing([
      at('2026-11-22T01:00:00Z', MANILA),
      at('2026-11-22T05:30:00Z', SINGAPORE),
    ]);
    expect(r.flagged).toBe(false);
  });

  it('ignores events without coordinates for travel and sorts input by time', () => {
    const noCoords = { country: 'PH', region: null, city: null, latitude: null, longitude: null };
    const r = assessSharing([
      at('2026-11-22T01:30:00Z', SINGAPORE),
      at('2026-11-22T01:10:00Z', noCoords),
      at('2026-11-22T01:00:00Z', MANILA),
    ]);
    expect(r.jumps).toHaveLength(1);
  });

  it('honours custom thresholds', () => {
    const r = assessSharing(
      [at('2026-11-22T01:00:00Z', MANILA), at('2026-11-22T02:00:00Z', QC)],
      { minPlaces: 2, minJumpKm: 500, maxSpeedKmh: 900 },
    );
    expect(r.reasons).toEqual(['many_places']);
  });
});
