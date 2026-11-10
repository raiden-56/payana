import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import type { UpdateRatesRequest, Vehicle, VehicleCategory } from '@payana/contracts';
import { toApiError } from '@core/api/api-error';
import { PartnerApi } from '@core/api/partner.api';
import { MoneyPipe, minorToRupees, rupeesToMinor } from '@core/util/format';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { bandPosition, perKmProblem } from '../partner-logic';
import { PartnerStore } from '../partner.store';
import { fieldErrors } from '../shared/form-errors';

/**
 * A vehicle's indicative rates. The per-km rate has to sit inside the band
 * the platform sets for the vehicle's category; the gauge shows where.
 */
@Component({
  selector: 'app-rates-editor',
  imports: [ReactiveFormsModule, Icon, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (category(); as cat) {
      <form class="rates" (submit)="$event.preventDefault(); save()" novalidate>
        <p class="rates__intro">
          These are the rates shown on your listing. They are a guide for customers — the fare for each trip is whatever you quote.
        </p>

        <div class="field">
          <label class="field__label" for="rt-km">Rate per kilometre</label>
          <div class="input-group">
            <span class="input-group__addon" aria-hidden="true">₹</span>
            <input
              id="rt-km"
              class="input"
              type="number"
              inputmode="decimal"
              step="0.5"
              [formControl]="form.controls.perKm"
              [attr.aria-invalid]="errors.invalid('perKm')"
              aria-describedby="rt-km-help"
            />
          </div>
          <div class="band" aria-hidden="true">
            <span class="band__track"><span class="band__dot" [class.is-out]="!!perKmIssue()" [style.left.%]="position() * 100"></span></span>
            <span class="band__ends"><span>{{ cat.pricing.minPerKm | money }}</span><span>{{ cat.pricing.maxPerKm | money }}</span></span>
          </div>
          @if (errors.message('perKm'); as message) {
            <p class="field__error" id="rt-km-help"><app-icon name="alert-circle" [size]="14" /> {{ message }}</p>
          } @else {
            <p class="field__hint" id="rt-km-help">
              Allowed for {{ cat.name }}: {{ cat.pricing.minPerKm | money }} to {{ cat.pricing.maxPerKm | money }} per km. Typical: {{ cat.pricing.perKm | money }}.
            </p>
          }
        </div>

        <div class="form-grid">
          <div class="field">
            <label class="field__label" for="rt-base">Base fare</label>
            <div class="input-group">
              <span class="input-group__addon" aria-hidden="true">₹</span>
              <input id="rt-base" class="input" type="number" inputmode="decimal" step="1" [formControl]="form.controls.baseFare" [attr.aria-invalid]="errors.invalid('baseFare')" aria-describedby="rt-base-help" />
            </div>
            @if (errors.message('baseFare'); as message) {
              <p class="field__error" id="rt-base-help"><app-icon name="alert-circle" [size]="14" /> {{ message }}</p>
            } @else {
              <p class="field__hint" id="rt-base-help">Minimum charge for a short trip. Typical: {{ cat.pricing.baseFare | money }}.</p>
            }
          </div>
          <div class="field">
            <label class="field__label" for="rt-wait">Waiting, per hour</label>
            <div class="input-group">
              <span class="input-group__addon" aria-hidden="true">₹</span>
              <input id="rt-wait" class="input" type="number" inputmode="decimal" step="1" [formControl]="form.controls.perHourWaiting" [attr.aria-invalid]="errors.invalid('perHourWaiting')" aria-describedby="rt-wait-help" />
            </div>
            @if (errors.message('perHourWaiting'); as message) {
              <p class="field__error" id="rt-wait-help"><app-icon name="alert-circle" [size]="14" /> {{ message }}</p>
            } @else {
              <p class="field__hint" id="rt-wait-help">Typical: {{ cat.pricing.perHourWaiting | money }}.</p>
            }
          </div>
          <div class="field span-2">
            <label class="field__label" for="rt-day">Full day — 8 hours / 80 km <span class="field__optional">(optional)</span></label>
            <div class="input-group">
              <span class="input-group__addon" aria-hidden="true">₹</span>
              <input id="rt-day" class="input" type="number" inputmode="decimal" step="50" [formControl]="form.controls.fullDay" [attr.aria-invalid]="errors.invalid('fullDay')" aria-describedby="rt-day-help" />
            </div>
            @if (errors.message('fullDay'); as message) {
              <p class="field__error" id="rt-day-help"><app-icon name="alert-circle" [size]="14" /> {{ message }}</p>
            } @else {
              <p class="field__hint" id="rt-day-help">Leave empty if you do not offer day hire.</p>
            }
          </div>
        </div>

        @if (problem()) {
          <p class="notice notice--danger" role="alert"><app-icon name="alert-circle" [size]="18" /> <span>{{ problem() }}</span></p>
        }

        <div class="form-actions">
          <button type="button" class="btn btn--ghost" [disabled]="busy()" (click)="cancelled.emit()">Cancel</button>
          <button type="submit" class="btn btn--accent" [class.is-loading]="busy()" [disabled]="busy()">Save rates</button>
        </div>
      </form>
    } @else {
      <p class="notice notice--warning" role="alert">
        <app-icon name="alert" [size]="18" />
        <span>This vehicle’s category is no longer offered, so its rates cannot be changed. Contact support.</span>
      </p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .rates {
      display: grid;
      gap: 1.1rem;
    }
    .rates__intro {
      font-size: var(--fs-sm);
      color: var(--color-text-muted);
    }
    .band {
      display: grid;
      gap: 0.2rem;
      margin-top: 0.35rem;
    }
    .band__track {
      position: relative;
      height: 0.55rem;
      border-radius: var(--r-pill);
      background: linear-gradient(90deg, var(--palm-300), var(--marigold-300), var(--laterite-300));
      border: 1px solid var(--ink-900);
    }
    .band__dot {
      position: absolute;
      top: 50%;
      width: 1.15rem;
      height: 1.15rem;
      border: var(--stroke) solid var(--ink-900);
      border-radius: 50%;
      background: var(--sand-0);
      transform: translate(-50%, -50%);
      transition: left var(--dur-3) var(--ease-out), background-color var(--dur-2);
    }
    .band__dot.is-out {
      background: var(--crimson-600);
    }
    .band__ends {
      display: flex;
      justify-content: space-between;
      font-size: var(--fs-xs);
      font-weight: 650;
      color: var(--ink-600);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class RatesEditor {
  readonly vehicle = input.required<Vehicle>();
  readonly saved = output<Vehicle>();
  readonly cancelled = output<void>();

  private readonly api = inject(PartnerApi);
  private readonly toasts = inject(ToastService);
  private readonly store = inject(PartnerStore);

  protected readonly form = new FormGroup({
    perKm: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    baseFare: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
    perHourWaiting: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
    fullDay: new FormControl<number | null>(null, [Validators.min(1)]),
  });

  protected readonly errors = fieldErrors(
    this.form,
    {
      perKm: { required: 'Enter your rate per kilometre.', min: 'Enter your rate per kilometre.' },
      baseFare: { required: 'Enter a base fare, or 0.', min: 'Enter 0 or more.' },
      perHourWaiting: { required: 'Enter a waiting charge, or 0.', min: 'Enter 0 or more.' },
      fullDay: { min: 'Enter an amount, or leave it empty.' },
    },
    { perKmMinor: 'perKm', baseFareMinor: 'baseFare', perHourWaitingMinor: 'perHourWaiting', fullDayMinor: 'fullDay' },
  );

  protected readonly busy = signal(false);
  protected readonly problem = signal('');

  protected readonly category = computed<VehicleCategory | undefined>(() => this.store.categoryFor(this.vehicle()));
  private readonly perKmValue = toSignal(this.form.controls.perKm.valueChanges, { initialValue: null });
  private readonly perKmMinor = computed(() => rupeesToMinor(this.perKmValue()));

  protected readonly perKmIssue = computed(() => {
    const cat = this.category();
    return cat && this.perKmMinor() !== null ? perKmProblem(this.perKmMinor(), cat.pricing) : null;
  });
  protected readonly position = computed(() => {
    const cat = this.category();
    return cat ? bandPosition(this.perKmMinor(), cat.pricing) : 0;
  });

  constructor() {
    // Start from the vehicle's current rates, or the category's typical ones.
    effect(() => {
      const v = this.vehicle();
      const cat = this.category();
      untracked(() => {
        const rates = v.rates;
        this.form.reset({
          perKm: minorToRupees(rates?.perKm.amountMinor ?? cat?.pricing.perKm.amountMinor),
          baseFare: minorToRupees(rates?.baseFare.amountMinor ?? cat?.pricing.baseFare.amountMinor),
          perHourWaiting: minorToRupees(rates?.perHourWaiting.amountMinor ?? cat?.pricing.perHourWaiting.amountMinor),
          fullDay: minorToRupees(rates?.fullDay?.amountMinor),
        });
        this.problem.set('');
        this.errors.clear();
      });
    });
  }

  protected save(): void {
    const cat = this.category();
    if (this.busy() || !cat) return;
    this.problem.set('');
    const valid = this.errors.validate();

    const value = this.form.getRawValue();
    const perKmMinor = rupeesToMinor(value.perKm);
    const bandIssue = perKmProblem(perKmMinor, cat.pricing);
    if (bandIssue) this.errors.set('perKm', bandIssue);
    if (!valid || bandIssue) return;

    const body: UpdateRatesRequest = {
      vehicleId: this.vehicle().id,
      perKmMinor: perKmMinor!,
      baseFareMinor: rupeesToMinor(value.baseFare) ?? 0,
      perHourWaitingMinor: rupeesToMinor(value.perHourWaiting) ?? 0,
      fullDayMinor: rupeesToMinor(value.fullDay),
    };

    this.busy.set(true);
    this.api.saveRates(body).subscribe({
      next: (vehicle) => {
        this.busy.set(false);
        this.store.refreshVehicles();
        this.toasts.success('Rates saved.');
        this.saved.emit(vehicle);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        const apiError = toApiError(error);
        const unplaced = this.errors.accept(apiError);
        // When every complaint landed on a field, the fields speak for themselves.
        this.problem.set(unplaced[0] ?? (apiError.fieldErrors.length ? '' : (apiError.problem?.detail ?? apiError.message)));
      },
    });
  }
}
