import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RegionStatus, type PurchaseFeaturedPlacementRequest } from '@payana/contracts';
import { toApiError } from '@core/api/api-error';
import { PartnerApi } from '@core/api/partner.api';
import { newIdempotencyKey } from '@core/platform/platform';
import { DateOnlyPipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { StatePanel } from '@ui/primitives';
import { StatusBadge } from '@ui/status';
import { IdempotencyKeys, formatRegistration, toIsoDate } from '../partner-logic';
import { PartnerStore } from '../partner.store';
import { fieldErrors } from '../shared/form-errors';

/** Featured listings: a vehicle shown at the top of search in one town for a few days, always labelled as featured. */
@Component({
  selector: 'app-featured-placements',
  imports: [ReactiveFormsModule, Icon, StatePanel, StatusBadge, DateOnlyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 id="feat-title">Featured listing</h2>
    <p class="lead">Put one vehicle at the top of search in a town for up to 30 days. Customers see it marked “Featured”. Days included in your plan are used first.</p>

    <form class="buy" aria-labelledby="feat-title" (submit)="$event.preventDefault(); purchase()" novalidate>
      <div class="field">
        <label class="field__label" for="ft-vehicle">Vehicle</label>
        <select id="ft-vehicle" class="select" [formControl]="form.controls.vehicleId" [attr.aria-invalid]="errors.invalid('vehicleId')">
          <option value="" disabled>Choose…</option>
          @for (v of vehicles(); track v.id) { <option [value]="v.id">{{ v.label }}</option> }
        </select>
        @if (errors.message('vehicleId'); as m) { <p class="field__error"><app-icon name="alert-circle" [size]="14" /> {{ m }}</p> }
      </div>
      <div class="field">
        <label class="field__label" for="ft-region">Town</label>
        <select id="ft-region" class="select" [formControl]="form.controls.regionSlug" [attr.aria-invalid]="errors.invalid('regionSlug')">
          <option value="" disabled>Choose…</option>
          @for (r of regions(); track r.id) { <option [value]="r.slug">{{ r.name }}</option> }
        </select>
        @if (errors.message('regionSlug'); as m) { <p class="field__error"><app-icon name="alert-circle" [size]="14" /> {{ m }}</p> }
      </div>
      <div class="field">
        <label class="field__label" for="ft-start">Starts on</label>
        <input id="ft-start" class="input" type="date" [min]="today" [formControl]="form.controls.startsOn" [attr.aria-invalid]="errors.invalid('startsOn')" />
        @if (errors.message('startsOn'); as m) { <p class="field__error"><app-icon name="alert-circle" [size]="14" /> {{ m }}</p> }
      </div>
      <div class="field">
        <label class="field__label" for="ft-days">Days</label>
        <input id="ft-days" class="input" type="number" inputmode="numeric" min="1" max="30" [formControl]="form.controls.days" [attr.aria-invalid]="errors.invalid('days')" />
        @if (errors.message('days'); as m) { <p class="field__error"><app-icon name="alert-circle" [size]="14" /> {{ m }}</p> }
      </div>
      @if (problem()) {
        <p class="notice notice--danger wide" role="alert"><app-icon name="alert-circle" [size]="18" /> <span>{{ problem() }}</span></p>
      }
      <button type="submit" class="btn btn--dark wide" [class.is-loading]="busy()" [disabled]="busy() || !vehicles().length"><app-icon name="sparkle" [size]="16" /> Feature this vehicle</button>
    </form>

    @switch (placements.status()) {
      @case ('error') {
        <app-state-panel [error]="placements.error()" (retry)="placements.load()" />
      }
      @case ('ready') {
        @if (placements.data()!.length) {
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th scope="col">Vehicle</th><th scope="col">Town</th><th scope="col">From</th><th scope="col">Until</th><th scope="col">Status</th></tr></thead>
              <tbody>
                @for (p of placements.data(); track p.id) {
                  <tr>
                    <td>{{ vehicleLabel(p.vehicleId) }}</td>
                    <td>{{ regionName(p.regionSlug) }}</td>
                    <td>{{ p.startsOn | dateOnly }}</td>
                    <td>{{ p.endsOn | dateOnly }}</td>
                    <td><app-status-badge kind="placement" [value]="p.status" />@if (p.fromPlanAllowance) { <span class="subtle"> · from plan</span> }</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
      @default {
        <span class="skeleton" style="height: 6rem; border-radius: var(--r-md)" aria-hidden="true"></span>
      }
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--s-4);
    }
    h2 {
      font-size: 1.35rem;
    }
    .lead {
      max-width: 44rem;
      color: var(--color-text-muted);
    }
    .buy {
      display: grid;
      gap: 0.9rem;
      align-items: start;
      padding: 1.1rem;
      border: var(--stroke) solid var(--color-border);
      border-radius: var(--r-md);
      background: var(--color-surface);
    }
    @media (min-width: 48rem) {
      .buy {
        grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.6fr);
      }
      .wide {
        grid-column: 1 / -1;
        justify-self: start;
      }
    }
  `,
})
export class FeaturedPlacements {
  private readonly api = inject(PartnerApi);
  private readonly toasts = inject(ToastService);
  private readonly store = inject(PartnerStore);
  private readonly keys = new IdempotencyKeys(newIdempotencyKey);

  protected readonly today = toIsoDate(new Date());
  protected readonly placements = loader(() => this.api.featuredPlacements());
  protected readonly busy = signal(false);
  protected readonly problem = signal('');

  protected readonly form = new FormGroup({
    vehicleId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    regionSlug: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    startsOn: new FormControl(this.today, { nonNullable: true, validators: [Validators.required] }),
    days: new FormControl<number | null>(7, [Validators.required, Validators.min(1), Validators.max(30)]),
  });
  protected readonly errors = fieldErrors(this.form, {
    vehicleId: { required: 'Choose a vehicle.' },
    regionSlug: { required: 'Choose a town.' },
    startsOn: { required: 'Choose a start date.' },
    days: { required: 'Enter 1 to 30 days.', min: 'At least 1 day.', max: 'At most 30 days.' },
  });

  protected readonly vehicles = computed(() =>
    (this.store.vehicles.data() ?? []).map((v) => ({ id: v.id, label: `${v.make} ${v.model} · ${formatRegistration(v.registrationNumber)}` })),
  );
  protected readonly regions = computed(() => (this.store.regions.data() ?? []).filter((r) => r.status === RegionStatus.Live));

  constructor() {
    this.placements.load();
  }

  protected vehicleLabel(id: string): string {
    return this.vehicles().find((v) => v.id === id)?.label ?? 'Removed vehicle';
  }

  protected regionName(slug: string): string {
    return (this.store.regions.data() ?? []).find((r) => r.slug === slug)?.name ?? slug;
  }

  protected purchase(): void {
    if (this.busy()) return;
    this.problem.set('');
    const valid = this.errors.validate();
    const value = this.form.getRawValue();
    if (value.startsOn && value.startsOn < this.today) this.errors.set('startsOn', 'Choose today or a later date.');
    if (!valid || this.errors.hasMessages()) return;

    const body: PurchaseFeaturedPlacementRequest = {
      vehicleId: value.vehicleId,
      regionSlug: value.regionSlug,
      startsOn: value.startsOn,
      days: value.days!,
    };
    this.busy.set(true);
    this.api.purchaseFeaturedPlacement(body, this.keys.keyFor(body)).subscribe({
      next: (placement) => {
        this.busy.set(false);
        this.placements.load({ silent: true });
        this.toasts.success(placement.fromPlanAllowance ? 'Featured placement booked from the days included in your plan.' : 'Featured placement booked.');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        const apiError = toApiError(error);
        const unplaced = this.errors.accept(apiError);
        this.problem.set(unplaced[0] ?? (apiError.fieldErrors.length ? '' : (apiError.problem?.detail ?? apiError.message)));
      },
    });
  }
}
