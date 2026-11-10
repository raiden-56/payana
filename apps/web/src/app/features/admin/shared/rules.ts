import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Pure business checks used by the admin forms. Kept free of Angular state so
 * they can be unit-tested directly (see rules.spec.ts). The API applies the
 * same rules again - these only give the administrator an answer sooner.
 */

// --- category pricing ---------------------------------------------------------

export interface PricingBounds {
  /** All values in rupees, as typed. */
  minPerKm: number | null;
  perKm: number | null;
  maxPerKm: number | null;
}

/** Null when min ≤ default ≤ max and all three are positive; otherwise what is wrong. */
export function checkPricingBounds(b: PricingBounds): string | null {
  const { minPerKm, perKm, maxPerKm } = b;
  if (minPerKm === null || perKm === null || maxPerKm === null) return null; // "required" reports blanks
  if ([minPerKm, perKm, maxPerKm].some((n) => !Number.isFinite(n) || n <= 0)) {
    return 'Per-km rates must be more than zero.';
  }
  if (minPerKm > maxPerKm) return 'The lowest per-km rate cannot be higher than the highest.';
  if (perKm < minPerKm) return 'The typical per-km rate cannot be below the lowest rate drivers may publish.';
  if (perKm > maxPerKm) return 'The typical per-km rate cannot be above the highest rate drivers may publish.';
  return null;
}

/** Group validator for a form group with minPerKm / perKm / maxPerKm controls (rupees). */
export const pricingBoundsValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const num = (name: string): number | null => {
    const raw = group.get(name)?.value;
    return raw === null || raw === '' || raw === undefined ? null : Number(raw);
  };
  const message = checkPricingBounds({ minPerKm: num('minPerKm'), perKm: num('perKm'), maxPerKm: num('maxPerKm') });
  return message ? { message } : null;
};

// --- advertisements -------------------------------------------------------------

/** Click-through rate as a fraction (0.034 = 3.4%). Null until there is an impression. */
export function clickThroughRate(impressions: number, clicks: number): number | null {
  if (!Number.isFinite(impressions) || impressions <= 0) return null;
  return Math.max(0, clicks) / impressions;
}

export function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${(rate * 100).toFixed(rate < 0.1 ? 2 : 1)}%`;
}

const TEL = /^tel:\+?\d[\d\s-]{5,18}$/;

/**
 * An advertiser's call-to-action may only open a secure web page or dial a
 * number. Everything else (http:, javascript:, data:, mailto:, relative paths)
 * is refused, because the link is rendered to the public.
 */
export function isAllowedCtaUrl(value: string | null | undefined): boolean {
  const url = (value ?? '').trim();
  if (!url) return false;
  if (TEL.test(url)) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.includes('.') && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export const ctaUrlValidator: ValidatorFn = (control): ValidationErrors | null => {
  if (!control.value) return null;
  return isAllowedCtaUrl(control.value)
    ? null
    : { message: 'Use an https:// web address or a tel: number, for example tel:+919876543210.' };
};

/** Optional image address: empty, or https only. */
export const httpsUrlValidator: ValidatorFn = (control): ValidationErrors | null => {
  const value = String(control.value ?? '').trim();
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? null : { message: 'Use an https:// address.' };
  } catch {
    return { message: 'Use an https:// address.' };
  }
};

/** Group validator: the `endsOn` date may not be before `startsOn`. */
export const dateOrderValidator: ValidatorFn = (group): ValidationErrors | null => {
  const start = group.get('startsOn')?.value as string | null;
  const end = group.get('endsOn')?.value as string | null;
  return start && end && end < start ? { message: 'The end date cannot be before the start date.' } : null;
};

// --- slugs -----------------------------------------------------------------------

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CODE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** "Mirjan Fort & Kumta" -> "mirjan-fort-kumta". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// --- passwords ---------------------------------------------------------------------

/** A random temporary password: 4 groups of 4 from an unambiguous alphabet, e.g. "k7Qm-R2xw-9TbN-hV4c". */
export function generateTemporaryPassword(random: (max: number) => number = secureRandom): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const group = () => Array.from({ length: 4 }, () => alphabet[random(alphabet.length)]).join('');
  return [group(), group(), group(), group()].join('-');
}

function secureRandom(max: number): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0]! % max;
}
