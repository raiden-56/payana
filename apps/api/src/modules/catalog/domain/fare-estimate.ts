import type { FareEstimate, LatLng } from '@payana/contracts';
import { haversineKm } from '../../../common/geo.js';
import { inr } from '../../../common/money.js';

/** Coastal roads wind: road distance is taken as this multiple of the straight line. */
export const ROAD_FACTOR = 1.3;
/** Average speed assumed for the duration estimate. */
export const AVERAGE_SPEED_KMH = 28;
const ROUND_TO_MINOR = 1000; // nearest Rs 10

export interface CategoryPricingFacts {
  baseFareMinor: number;
  minPerKmMinor: number;
  maxPerKmMinor: number;
}

const roundUp = (minor: number) => Math.ceil(minor / ROUND_TO_MINOR) * ROUND_TO_MINOR;

/**
 * A deliberately rough, non-binding estimate from straight-line distance and
 * the category's allowed per-km band. It is labelled `straight_line` so
 * clients present it as a range, never as a fare. A routing provider can
 * replace the distance later without changing the shape.
 */
export function estimateFare(from: LatLng, to: LatLng, pricing: CategoryPricingFacts): FareEstimate {
  const distanceKm = Math.max(0.5, Math.round(haversineKm(from, to) * ROAD_FACTOR * 10) / 10);
  const durationMinutes = Math.max(3, Math.round((distanceKm / AVERAGE_SPEED_KMH) * 60));
  const low = roundUp(pricing.baseFareMinor + pricing.minPerKmMinor * distanceKm);
  const high = Math.max(low, roundUp(pricing.baseFareMinor + pricing.maxPerKmMinor * distanceKm));
  return { distanceKm, durationMinutes, low: inr(low), high: inr(high), basis: 'straight_line' };
}
