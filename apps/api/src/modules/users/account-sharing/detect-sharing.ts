/**
 * Account-sharing signal (device limits, phase 2c). Pure: no I/O, so the
 * thresholds can be tested and re-measured against exported rows.
 *
 * Input is one user's successful sign-ins and token refreshes in a window,
 * each with the geoip-lite location of its IP. Two independent signals:
 *
 *  - places: the account was seen in at least `minPlaces` distinct places.
 *    A place is the city, falling back to region, then country. geoip-lite
 *    returns '' (not null) when it does not know the city, so blanks are
 *    treated as unknown rather than counted as a place.
 *  - impossible travel: two consecutive events further apart than
 *    `minJumpKm` at a speed above `maxSpeedKmh`. One person cannot do that;
 *    two people on one account can.
 *
 * Neither counts IP addresses: a whole firm shares one NAT egress IP, and
 * IP count is exactly the wrong signal for this user base.
 *
 * Mobile carrier IPs geolocate coarsely and sometimes far from the user, so
 * this is an ADVISORY signal for a human to review, never an automatic
 * action on the account.
 */

export interface SharingEvent {
  createdAt: Date;
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface SharingThresholds {
  minPlaces: number;
  minJumpKm: number;
  maxSpeedKmh: number;
}

export const DEFAULT_SHARING_THRESHOLDS: SharingThresholds = {
  minPlaces: 4,
  minJumpKm: 500,
  maxSpeedKmh: 900,
};

export interface TravelJump {
  from: string;
  to: string;
  km: number;
  minutes: number;
  at: Date;
}

export interface SharingAssessment {
  places: string[];
  jumps: TravelJump[];
  flagged: boolean;
  reasons: ('many_places' | 'impossible_travel')[];
}

const blank = (v: string | null | undefined): boolean => !v || v.trim() === '';

/** "Quezon City, PH" / "Calabarzon, PH" / "PH"; null when nothing is known. */
export function placeOf(e: Pick<SharingEvent, 'country' | 'region' | 'city'>): string | null {
  const country = blank(e.country) ? null : e.country!.trim();
  if (!blank(e.city)) return country ? `${e.city!.trim()}, ${country}` : e.city!.trim();
  if (!blank(e.region)) return country ? `${e.region!.trim()}, ${country}` : e.region!.trim();
  return country;
}

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function assessSharing(
  events: SharingEvent[],
  thresholds: SharingThresholds = DEFAULT_SHARING_THRESHOLDS,
): SharingAssessment {
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const places = [...new Set(sorted.map(placeOf).filter((p): p is string => p !== null))];

  const jumps: TravelJump[] = [];
  let prev: SharingEvent | null = null;
  for (const e of sorted) {
    if (e.latitude === null || e.longitude === null) continue;
    if (prev && prev.latitude !== null && prev.longitude !== null) {
      const km = haversineKm(prev.latitude, prev.longitude, e.latitude, e.longitude);
      // Floor at one minute: two events in the same second are not infinitely fast.
      const minutes = Math.max(1, (e.createdAt.getTime() - prev.createdAt.getTime()) / 60000);
      if (km > thresholds.minJumpKm && km / (minutes / 60) > thresholds.maxSpeedKmh) {
        jumps.push({
          from: placeOf(prev) ?? 'unknown',
          to: placeOf(e) ?? 'unknown',
          km: Math.round(km),
          minutes: Math.round(minutes),
          at: e.createdAt,
        });
      }
    }
    prev = e;
  }

  const reasons: SharingAssessment['reasons'] = [];
  if (places.length >= thresholds.minPlaces) reasons.push('many_places');
  if (jumps.length > 0) reasons.push('impossible_travel');
  return { places, jumps, flagged: reasons.length > 0, reasons };
}
