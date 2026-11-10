import { AbstractControl, FormArray, FormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';
import { ApiError, toApiError } from '@core/api/api-error';

/**
 * The sentence to show under a field, or null when there is nothing to say.
 * Custom validators in this folder return `{ message: '…' }`; errors copied
 * from the API arrive as `{ server: '…' }`.
 */
export function controlError(control: AbstractControl | null | undefined, label = 'This'): string | null {
  if (!control?.errors || !(control.touched || control.dirty)) return null;
  const e = control.errors;
  if (e['server']) return String(e['server']);
  if (e['message']) return String(e['message']);
  if (e['required']) return `${label} is required.`;
  if (e['email']) return 'Enter a valid e-mail address.';
  if (e['minlength']) return `${label} needs at least ${e['minlength'].requiredLength} characters.`;
  if (e['maxlength']) return `${label} can be at most ${e['maxlength'].requiredLength} characters.`;
  if (e['min']) return `${label} must be ${e['min'].min} or more.`;
  if (e['max']) return `${label} must be ${e['max'].max} or less.`;
  if (e['pattern']) return `${label} is not in the expected format.`;
  return `${label} is not valid.`;
}

/**
 * Copies the API's per-field errors onto the matching controls (by dot path,
 * e.g. "pricing.perKm" or "stops.2.name") and returns the message to show at
 * the top of the form: the general message plus anything that had no control.
 */
export function applyServerErrors(form: AbstractControl, error: unknown): string {
  const apiError: ApiError = toApiError(error);
  const unmatched: string[] = [];
  for (const fieldError of apiError.fieldErrors) {
    const control = form.get(fieldError.field);
    if (control) {
      control.setErrors({ ...(control.errors ?? {}), server: fieldError.message });
      control.markAsTouched();
    } else {
      unmatched.push(`${fieldError.field}: ${fieldError.message}`);
    }
  }
  return [apiError.message, ...unmatched].join(' ');
}

/** Marks every control touched so that all problems show after a failed submit. */
export function touchAll(control: AbstractControl): void {
  control.markAllAsTouched();
  if (control instanceof FormGroup || control instanceof FormArray) {
    Object.values(control.controls).forEach((child) => child.updateValueAndValidity({ emitEvent: false }));
  }
}

/** Whole number check for inputs of type number (which accept "1.5" and "1e3"). */
export const wholeNumber: ValidatorFn = (control): ValidationErrors | null => {
  const value = control.value;
  if (value === null || value === '' || value === undefined) return null;
  return Number.isInteger(Number(value)) ? null : { message: 'Use a whole number.' };
};

/** "a\n b \n\n c" -> ["a", "b", "c"]. Used for one-per-line list fields. */
export function linesToList(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function listToLines(list: readonly string[] | null | undefined): string {
  return (list ?? []).join('\n');
}

/** Today as "YYYY-MM-DD" in the administrator's own time zone. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days from today until an ISO date; negative when it is in the past. Null when unparsable. */
export function daysUntil(isoDate: string | null | undefined, now: Date = new Date()): number | null {
  if (!isoDate) return null;
  const target = new Date(isoDate.length === 10 ? `${isoDate}T00:00:00` : isoDate);
  if (Number.isNaN(target.getTime())) return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target.getTime() - start) / 86_400_000);
}
