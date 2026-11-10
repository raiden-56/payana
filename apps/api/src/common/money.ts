import { Currency, type Money } from '@payana/contracts';

export const inr = (amountMinor: number): Money => ({ amountMinor, currency: Currency.INR });
export const inrOrNull = (amountMinor: number | null | undefined): Money | null =>
  amountMinor === null || amountMinor === undefined ? null : inr(amountMinor);

/** Postgres returns bigint / numeric as strings. */
export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
export const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const iso = (d: Date | string | null | undefined): string | null =>
  d === null || d === undefined ? null : new Date(d).toISOString();
export const isoReq = (d: Date | string): string => new Date(d).toISOString();
/** DATE columns come back as "YYYY-MM-DD" strings (or Date); normalise to the string form. */
export const dateOnly = (d: Date | string | null | undefined): string | null => {
  if (d === null || d === undefined) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
