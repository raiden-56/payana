import {
  LOCATION_LIVE_MAX_AGE_SECONDS,
  LOCATION_RECENT_MAX_AGE_SECONDS,
  LocationFreshness,
  type LatLng,
} from '@payana/contracts';

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * How far a driver's last reported position can be trusted. A null timestamp
 * is "unknown"; anything older than the recent window is "stale" and must not
 * be presented as a current position.
 */
export function classifyFreshness(updatedAt: Date | null, now: Date = new Date()): LocationFreshness {
  if (!updatedAt) return LocationFreshness.Unknown;
  const ageSeconds = (now.getTime() - updatedAt.getTime()) / 1000;
  if (ageSeconds <= LOCATION_LIVE_MAX_AGE_SECONDS) return LocationFreshness.Live;
  if (ageSeconds <= LOCATION_RECENT_MAX_AGE_SECONDS) return LocationFreshness.Recent;
  return LocationFreshness.Stale;
}

export function isFresh(freshness: LocationFreshness): boolean {
  return freshness === LocationFreshness.Live || freshness === LocationFreshness.Recent;
}

/** Round a bearing to the nearest 10 degrees, normalised to 0-350. */
export function roundBearing(deg: number): number {
  return ((Math.round(deg / 10) * 10) % 360 + 360) % 360;
}

export function roundKm(km: number): number {
  return Math.round(km * 10) / 10;
}

export function isValidLatLng(p: LatLng): boolean {
  return (
    Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180
  );
}
