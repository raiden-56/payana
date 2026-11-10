import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ErrorCode,
  MAX_QUOTE_LINE_ITEMS,
  QUOTE_INCLUSION_SUGGESTIONS,
  TripType,
  type DriverRequestFeedItem,
  type Quote,
  type SubmitQuoteRequest,
} from '@payana/contracts';
import { toApiError } from '@core/api/api-error';
import { PartnerApi } from '@core/api/partner.api';
import { newIdempotencyKey } from '@core/platform/platform';
import { MoneyPipe } from '@core/util/format';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { IdempotencyKeys, fareOutlier, parseFare, validityLabel, validityOptions } from '../partner-logic';
import { PartnerStore } from '../partner.store';
import { fieldErrors } from '../shared/form-errors';

/** The driver's answer to a request: a fare, what it covers, and how long the offer stands. */
@Component({
  selector: 'app-quote-form',
  imports: [ReactiveFormsModule, RouterLink, Icon, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quote-form.html',
  styleUrl: './quote-form.scss',
})
export class QuoteForm {
  readonly request = input.required<DriverRequestFeedItem>();
  readonly sent = output<Quote>();

  private readonly api = inject(PartnerApi);
  private readonly toasts = inject(ToastService);
  protected readonly store = inject(PartnerStore);

  protected readonly suggestions = QUOTE_INCLUSION_SUGGESTIONS;
  protected readonly maxItems = MAX_QUOTE_LINE_ITEMS;
  // A retry of the same quote reuses its key; an edited quote gets a new one.
  private readonly keys = new IdempotencyKeys(newIdempotencyKey);

  protected readonly form = new FormGroup({
    vehicleId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    fare: new FormControl('', { nonNullable: true }),
    pickupNote: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    etaMinutes: new FormControl<number | null>(null, [Validators.min(1), Validators.max(180)]),
    validForMinutes: new FormControl<number>(10, { nonNullable: true }),
  });

  protected readonly errors = fieldErrors(
    this.form,
    {
      vehicleId: { required: 'Choose the vehicle you will bring.' },
      pickupNote: { maxlength: 'Keep it under 200 characters.' },
      etaMinutes: { min: 'Enter at least 1 minute.', max: 'Enter 180 minutes or fewer.' },
    },
    { fareMinor: 'fare' },
    ['inclusions', 'exclusions'],
  );

  protected readonly inclusions = signal<string[]>([]);
  protected readonly exclusions = signal<string[]>([]);
  protected readonly newInclusion = signal('');
  protected readonly newExclusion = signal('');
  protected readonly busy = signal(false);
  protected readonly problem = signal('');
  protected readonly planLimit = signal(false);
  protected readonly outlier = signal<'much_lower' | 'much_higher' | null>(null);

  protected readonly isImmediate = computed(() => this.request().tripType === TripType.Immediate);
  protected readonly validity = computed(() => {
    const minutesLeft = (new Date(this.request().expiresAt).getTime() - Date.now()) / 60_000;
    return validityOptions(this.request().tripType, minutesLeft).map((minutes) => ({ minutes, label: validityLabel(minutes) }));
  });

  /** Vehicles of the requested category first; anything else is offered with a warning. */
  protected readonly vehicles = computed(() => {
    const wanted = this.request().categoryCode;
    return this.store
      .operableVehicles()
      .map((v) => ({ ...v, matches: v.vehicle ? v.vehicle.categoryCode === wanted : null }))
      .sort((a, b) => Number(b.matches === true) - Number(a.matches === true));
  });
  protected readonly wantedCategory = computed(
    () => this.store.categoryByCode().get(this.request().categoryCode)?.name ?? this.request().categoryCode,
  );

  constructor() {
    // Sensible starting values for this request.
    effect(() => {
      const vehicles = this.vehicles();
      const validity = this.validity();
      const active = this.store.profile.data()?.activeVehicleId;
      untracked(() => {
        const { vehicleId, validForMinutes } = this.form.controls;
        if (!vehicleId.value && vehicles.length) {
          vehicleId.setValue((vehicles.find((v) => v.matches) ?? vehicles.find((v) => v.id === active) ?? vehicles[0]!).id);
        }
        if (!validity.some((o) => o.minutes === validForMinutes.value)) {
          validForMinutes.setValue(validity[validity.length - 1]!.minutes);
        }
      });
    });
  }

  protected selectedMismatch(): boolean {
    return this.vehicles().find((v) => v.id === this.form.controls.vehicleId.value)?.matches === false;
  }

  protected toggleInclusion(item: string): void {
    this.errors.clearField('inclusions');
    this.inclusions.update((list) => {
      if (list.includes(item)) return list.filter((i) => i !== item);
      if (list.length >= MAX_QUOTE_LINE_ITEMS) {
        this.errors.set('inclusions', `List at most ${MAX_QUOTE_LINE_ITEMS} items.`);
        return list;
      }
      return [...list, item];
    });
  }

  protected add(kind: 'inclusions' | 'exclusions'): void {
    const draft = kind === 'inclusions' ? this.newInclusion : this.newExclusion;
    const list = kind === 'inclusions' ? this.inclusions : this.exclusions;
    const value = draft().trim().slice(0, 60);
    if (!value) return;
    this.errors.clearField(kind);
    if (list().length >= MAX_QUOTE_LINE_ITEMS) {
      this.errors.set(kind, `List at most ${MAX_QUOTE_LINE_ITEMS} items.`);
      return;
    }
    if (!list().some((i) => i.toLowerCase() === value.toLowerCase())) list.update((items) => [...items, value]);
    draft.set('');
  }

  protected removeExclusion(item: string): void {
    this.exclusions.update((list) => list.filter((i) => i !== item));
  }

  protected checkFare(): void {
    const parsed = parseFare(this.form.controls.fare.value);
    this.outlier.set('minor' in parsed ? fareOutlier(parsed.minor, this.request().estimate) : null);
  }

  protected send(): void {
    if (this.busy()) return;
    this.problem.set('');
    this.planLimit.set(false);
    const valid = this.errors.validate();
    const value = this.form.getRawValue();
    const fare = parseFare(value.fare);
    if ('problem' in fare) this.errors.set('fare', fare.problem);
    if (!valid || 'problem' in fare) return;

    const body: SubmitQuoteRequest = {
      vehicleId: value.vehicleId,
      fareMinor: fare.minor,
      inclusions: this.inclusions(),
      exclusions: this.exclusions(),
      ...(value.pickupNote.trim() ? { pickupNote: value.pickupNote.trim() } : {}),
      ...(this.isImmediate() && value.etaMinutes ? { etaMinutes: value.etaMinutes } : {}),
      validForMinutes: value.validForMinutes,
    };

    this.busy.set(true);
    this.api.submitQuote(this.request().requestId, body, this.keys.keyFor(body)).subscribe({
      next: (quote) => {
        this.busy.set(false);
        this.toasts.success('Quote sent. You will be notified if the customer accepts.');
        this.sent.emit(quote);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        const apiError = toApiError(error);
        const unplaced = this.errors.accept(apiError);
        this.planLimit.set(apiError.is(ErrorCode.EntitlementExceeded));
        this.problem.set(
          apiError.is(ErrorCode.EntitlementExceeded)
            ? 'You have used all the quotes your plan allows this month.'
            : (unplaced[0] ?? (apiError.fieldErrors.length ? '' : (apiError.problem?.detail ?? apiError.message))),
        );
      },
    });
  }
}
