import { BillingPeriod, type BookingFeeSettings } from '@payana/contracts';

/** Pure billing rules - no I/O. */

/** Days a lapsed paid subscription keeps its entitlements before dropping to the free plan. */
export const PAST_DUE_GRACE_DAYS = 3;
export const FREE_PLAN_CODE = 'free';

export function addPeriod(start: Date, period: BillingPeriod): Date {
  const end = new Date(start.getTime());
  const months = period === BillingPeriod.Monthly ? 1 : period === BillingPeriod.Quarterly ? 3 : 12;
  const day = end.getUTCDate();
  end.setUTCMonth(end.getUTCMonth() + months);
  // 31 Jan + 1 month must be the last day of February, not 3 March.
  if (end.getUTCDate() !== day) end.setUTCDate(0);
  return end;
}

/**
 * Platform booking fee for a quoted fare: flat part plus a percentage,
 * limited by the cap. Zero when the fee is switched off. Always a whole
 * number of paise, never negative.
 */
export function bookingFeeFor(quotedMinor: number, settings: BookingFeeSettings): number {
  if (!settings.enabled || quotedMinor <= 0) return 0;
  const raw = settings.flatMinor + Math.round((quotedMinor * settings.percent) / 100);
  const capped = settings.capMinor === null ? raw : Math.min(raw, settings.capMinor);
  return Math.max(0, Math.round(capped));
}

/** Inclusive day count between two calendar dates ("YYYY-MM-DD"). */
export function daysInclusive(startsOn: string, endsOn: string): number {
  const ms = Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function invoiceNumber(sequence: number, at: Date): string {
  return `INV-${at.getUTCFullYear()}-${String(sequence).padStart(6, '0')}`;
}
