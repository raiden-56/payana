import { Pipe, PipeTransform } from '@angular/core';
import type { Money } from '@payana/contracts';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const inrExact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});

/** 45000 -> "₹450". Paise are shown only when they are not zero. */
export function formatMoney(money: Money | number | null | undefined): string {
  if (money === null || money === undefined) return '—';
  const minor = typeof money === 'number' ? money : money.amountMinor;
  return minor % 100 === 0 ? inr.format(minor / 100) : inrExact.format(minor / 100);
}

/** Rupees typed by a person -> integer paise. Returns null for anything that is not a sensible amount. */
export function rupeesToMinor(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[,\s₹]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function minorToRupees(minor: number | null | undefined): number | null {
  return minor === null || minor === undefined ? null : minor / 100;
}

/** 0.42 -> "400 m", 3.14 -> "3.1 km", 27.6 -> "28 km". */
export function formatDistance(km: number | null | undefined): string {
  if (km === null || km === undefined) return '—';
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export function compass(bearingDeg: number | null | undefined): string {
  if (bearingDeg === null || bearingDeg === undefined) return '';
  return COMPASS[Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8]!;
}

const dayTime = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const timeOnly = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dayTime.format(d);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateOnly.format(d);
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : timeOnly.format(d);
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "in 5 minutes", "2 hours ago", "yesterday". */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const seconds = Math.round((t - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return seconds >= 0 ? 'in a moment' : 'just now';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86_400 * 30) return rtf.format(Math.round(seconds / 86_400), 'day');
  return formatDate(iso);
}

/** Value for an <input type="datetime-local"> in the visitor's own time zone. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "under_review" -> "Under review". */
export function humanize(value: string | null | undefined): string {
  if (!value) return '';
  const text = value.replace(/[_-]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0]![0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '')).toUpperCase();
}

/** "+919876543210" -> "+91 98765 43210". */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const m = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return m ? `+91 ${m[1]} ${m[2]}` : phone;
}

// --- pipes -------------------------------------------------------------------

@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: Money | number | null | undefined): string {
    return formatMoney(value);
  }
}

@Pipe({ name: 'distance' })
export class DistancePipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatDistance(value);
  }
}

@Pipe({ name: 'duration' })
export class DurationPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatDuration(value);
  }
}

@Pipe({ name: 'dateTime' })
export class DateTimePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return formatDateTime(value);
  }
}

@Pipe({ name: 'dateOnly' })
export class DateOnlyPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return formatDate(value);
  }
}

/** Impure on purpose: "3 minutes ago" has to move on without the input changing. */
@Pipe({ name: 'relativeTime', pure: false })
export class RelativeTimePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return formatRelative(value);
  }
}

@Pipe({ name: 'humanize' })
export class HumanizePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return humanize(value);
  }
}

@Pipe({ name: 'phone' })
export class PhonePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return formatPhone(value);
  }
}
