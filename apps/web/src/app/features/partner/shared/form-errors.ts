import { DestroyRef, inject, signal } from '@angular/core';
import { AbstractControl, FormGroup } from '@angular/forms';
import { ApiError } from '@core/api/api-error';

type Messages = Record<string, string>;

const DEFAULT_MESSAGES: Messages = {
  required: 'This is required.',
  min: 'That is too low.',
  max: 'That is too high.',
  minlength: 'That is too short.',
  maxlength: 'That is too long.',
  pattern: 'That does not look right.',
  email: 'Enter a valid e-mail address.',
};

/**
 * One place that decides what to print under a form field: the API's own
 * message for that field when there is one, otherwise the first failing
 * validator once the field has been touched.
 *
 * Create it in a field initialiser or constructor (it needs an injection
 * context to clean up its subscriptions):
 *
 *   readonly errors = fieldErrors(this.form, { fare: { min: 'Enter at least ₹1.' } }, { fareMinor: 'fare' });
 *
 * `apiFields` maps the API's field paths to control names where they differ.
 * `extra` names parts of the form that are not form controls (chip groups,
 * file pickers) but can still carry a message.
 */
export class FieldErrors {
  private readonly server = signal<Record<string, string>>({});

  constructor(
    private readonly form: FormGroup,
    private readonly messages: Record<string, Messages>,
    private readonly apiFields: Record<string, string>,
    private readonly extra: readonly string[],
    destroyRef: DestroyRef,
  ) {
    // An API complaint about a field stops applying as soon as that field is edited.
    for (const [name, control] of Object.entries(form.controls)) {
      const sub = control.valueChanges.subscribe(() => {
        this.clearField(name);
      });
      destroyRef.onDestroy(() => sub.unsubscribe());
    }
  }

  /** The sentence to show under `name`, or an empty string. */
  message(name: string): string {
    const fromApi = this.server()[name];
    if (fromApi) return fromApi;
    const control = this.form.get(name);
    if (!control || !control.errors || !(control.touched || control.dirty)) return '';
    return this.describe(name, control);
  }

  /** For `[attr.aria-invalid]`. */
  invalid(name: string): 'true' | null {
    return this.message(name) ? 'true' : null;
  }

  /**
   * Take the field errors out of an API failure. Returns the errors that did
   * not belong to any control, so the caller can show them some other way.
   */
  accept(error: ApiError): string[] {
    const mapped: Record<string, string> = {};
    const unplaced: string[] = [];
    for (const issue of error.fieldErrors) {
      const root = issue.field.split(/[.[]/)[0] ?? issue.field;
      const name = this.apiFields[issue.field] ?? this.apiFields[root] ?? root;
      if (this.form.get(name) || this.extra.includes(name)) mapped[name] ??= issue.message;
      else unplaced.push(issue.message);
    }
    this.server.set(mapped);
    return unplaced;
  }

  /** Set a message on a control by hand (for rules checked outside validators). */
  set(name: string, message: string): void {
    this.server.update((current) => ({ ...current, [name]: message }));
  }

  /** Drop the message on one field (after the person changed it). */
  clearField(name: string): void {
    if (!this.server()[name]) return;
    this.server.update((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  clear(): void {
    this.server.set({});
  }

  /** True while any field carries a message set by hand or by the API. */
  hasMessages(): boolean {
    return Object.keys(this.server()).length > 0;
  }

  /** Marks everything touched so messages appear, and says whether the form may be sent. */
  validate(): boolean {
    this.clear();
    this.form.markAllAsTouched();
    return this.form.valid;
  }

  private describe(name: string, control: AbstractControl): string {
    const key = Object.keys(control.errors ?? {})[0] ?? '';
    return this.messages[name]?.[key] ?? DEFAULT_MESSAGES[key] ?? 'Check this field.';
  }
}

export function fieldErrors(
  form: FormGroup,
  messages: Record<string, Messages> = {},
  apiFields: Record<string, string> = {},
  extra: readonly string[] = [],
): FieldErrors {
  return new FieldErrors(form, messages, apiFields, extra, inject(DestroyRef));
}
