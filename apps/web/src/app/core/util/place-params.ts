import type { ParamMap, Params } from '@angular/router';
import type { Place } from '@payana/contracts';

/**
 * A chosen place travels between pages in the URL (so a search can be
 * bookmarked, shared and survives a reload):
 *   ?from=Om%20Beach&fromLat=14.5197&fromLng=74.3185
 */
export function placeToParams(prefix: 'from' | 'to', place: Place | null): Params {
  if (!place) return {};
  return {
    [prefix]: place.label,
    [`${prefix}Lat`]: place.location.lat.toFixed(5),
    [`${prefix}Lng`]: place.location.lng.toFixed(5),
    ...(place.regionSlug ? { [`${prefix}Region`]: place.regionSlug } : {}),
  };
}

export function placeFromParams(prefix: 'from' | 'to', params: ParamMap): Place | null {
  const label = params.get(prefix);
  const lat = Number(params.get(`${prefix}Lat`));
  const lng = Number(params.get(`${prefix}Lng`));
  if (!label || !isLatLng(lat, lng)) return null;
  return {
    label: label.slice(0, 120),
    location: { lat, lng },
    regionSlug: params.get(`${prefix}Region`) ?? undefined,
  };
}

function isLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
  );
}
