import { ChangeDetectionStrategy, Component, inject, input, output, signal, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Currency, VehicleIcon, type VehicleCategory } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { HumanizePipe, minorToRupees, rupeesToMinor } from '@core/util/format';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { VehicleArt } from '@ui/vehicle-art';
import { applyServerErrors, controlError, touchAll, wholeNumber } from '../shared/forms';
import { CODE_PATTERN, pricingBoundsValidator } from '../shared/rules';

const money = (rupees: number | null) => ({ amountMinor: rupeesToMinor(rupees) ?? 0, currency: Currency.INR });

/** Add or edit a vehicle category and the pricing rules drivers must stay inside. */
@Component({
  selector: 'app-admin-category-form',
  imports: [ReactiveFormsModule, Icon, VehicleArt, HumanizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="a-editor" [formGroup]="form" (submit)="$event.preventDefault(); save()" novalidate>
      <header class="a-head">
        <div>
          <button type="button" class="a-back" (click)="cancelled.emit()"><app-icon name="arrow-left" [size]="16" /> Back to the catalogue</button>
          <h1>{{ category() ? 'Edit ' + category()!.name : 'New vehicle category' }}</h1>
        </div>
      </header>

      <fieldset class="a-fieldset">
        <legend>Category</legend>
        <div class="split">
          <div class="form-grid">
            <div class="field">
              <label class="field__label" for="vc-name">Name</label>
              <input id="vc-name" class="input" formControlName="name" maxlength="40" [attr.aria-invalid]="err(form.controls.name) ? 'true' : null" />
              @if (err(form.controls.name, 'Name'); as e) {
                <p class="field__error">{{ e }}</p>
              }
            </div>
            <div class="field">
              <label class="field__label" for="vc-code">Code</label>
              <input id="vc-code" class="input a-mono" formControlName="code" maxlength="30" aria-describedby="vc-code-help" [attr.aria-invalid]="err(form.controls.code) ? 'true' : null" />
              @if (err(form.controls.code, 'Code'); as e) {
                <p class="field__error">{{ e }}</p>
              } @else {
                <p class="field__hint" id="vc-code-help">{{ category() ? 'Fixed once created.' : 'Lower-case with underscores, e.g. "tempo_traveller".' }}</p>
              }
            </div>
            <div class="field span-2">
              <label class="field__label" for="vc-desc">Description <span class="field__optional">(optional)</span></label>
              <input id="vc-desc" class="input" formControlName="description" maxlength="140" />
            </div>
            <div class="field">
              <label class="field__label" for="vc-icon">Artwork</label>
              <select id="vc-icon" class="select" formControlName="icon">
                @for (i of icons; track i) {
                  <option [value]="i">{{ i | humanize }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label class="field__label" for="vc-sort">Position in lists</label>
              <input id="vc-sort" class="input tabular" type="number" step="1" formControlName="sortOrder" [attr.aria-invalid]="err(form.controls.sortOrder) ? 'true' : null" />
              @if (err(form.controls.sortOrder, 'Position'); as e) {
                <p class="field__error">{{ e }}</p>
              } @else {
                <p class="field__hint">Lower numbers come first.</p>
              }
            </div>
            <div class="field">
              <label class="field__label" for="vc-seats">Passenger seats</label>
              <input id="vc-seats" class="input tabular" type="number" step="1" inputmode="numeric" formControlName="seats" [attr.aria-invalid]="err(form.controls.seats) ? 'true' : null" />
              @if (err(form.controls.seats, 'Seats'); as e) {
                <p class="field__error">{{ e }}</p>
              }
            </div>
            <div class="field">
              <label class="field__label" for="vc-bags">Bags that fit</label>
              <input id="vc-bags" class="input tabular" type="number" step="1" inputmode="numeric" formControlName="luggageCapacity" [attr.aria-invalid]="err(form.controls.luggageCapacity) ? 'true' : null" />
              @if (err(form.controls.luggageCapacity, 'Bags'); as e) {
                <p class="field__error">{{ e }}</p>
              }
            </div>
          </div>
          <div class="a-preview" aria-hidden="true">
            <app-vehicle-art [icon]="form.controls.icon.value" />
          </div>
        </div>
        <label class="switch active">
          <input type="checkbox" role="switch" formControlName="isActive" />
          <span></span> Offered to customers and drivers
        </label>
      </fieldset>

      <fieldset class="a-fieldset" formGroupName="pricing">
        <legend>Pricing rules (₹)</legend>
        <p class="a-sub">Drivers' published per-km rates and their quotes must stay between the lowest and highest rate.</p>
        <div class="form-grid prices">
          @for (f of priceFields; track f.name) {
            <div class="field">
              <label class="field__label" [for]="'vc-' + f.name">{{ f.label }}</label>
              <div class="input-group">
                <span class="input-group__addon" aria-hidden="true">₹</span>
                <input
                  class="input tabular"
                  type="number"
                  step="0.5"
                  min="0"
                  inputmode="decimal"
                  [id]="'vc-' + f.name"
                  [formControlName]="f.name"
                  [attr.aria-invalid]="err(form.controls.pricing.controls[f.name]) || (f.bound && err(form.controls.pricing)) ? 'true' : null"
                />
              </div>
              @if (err(form.controls.pricing.controls[f.name], f.label); as e) {
                <p class="field__error">{{ e }}</p>
              }
            </div>
          }
        </div>
        @if (err(form.controls.pricing); as e) {
          <p class="notice notice--danger" role="alert"><app-icon name="alert-circle" [size]="18" /> <span>{{ e }}</span></p>
        }
      </fieldset>

      <div class="a-editor__bar">
        @if (problem()) {
          <span class="a-editor__msg" role="alert">{{ problem() }}</span>
        }
        <button type="button" class="btn btn--ghost" [disabled]="busy()" (click)="cancelled.emit()">Cancel</button>
        <button type="submit" class="btn btn--dark" [class.is-loading]="busy()" [disabled]="busy()">
          {{ category() ? 'Save changes' : 'Create category' }}
        </button>
      </div>
    </form>
  `,
  styles: `
    .split {
      display: grid;
      gap: 1rem;
      align-items: start;
    }
    @media (min-width: 48rem) {
      .split {
        grid-template-columns: minmax(0, 1fr) 15rem;
      }
    }
    .a-preview app-vehicle-art {
      width: 100%;
      max-width: 13rem;
    }
    .active {
      margin-top: 1.1rem;
    }
    @media (min-width: 48rem) {
      .prices {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
  `,
})
export class CategoryForm implements OnInit {
  /** The category being edited, or null to create one. */
  readonly category = input<VehicleCategory | null>(null);
  readonly saved = output<VehicleCategory>();
  readonly cancelled = output<void>();

  private readonly api = inject(AdminApi);
  private readonly toasts = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly icons = Object.values(VehicleIcon);
  protected readonly err = controlError;
  protected readonly busy = signal(false);
  protected readonly problem = signal('');

  protected readonly priceFields = [
    { name: 'baseFare', label: 'Base fare', bound: false },
    { name: 'perHourWaiting', label: 'Waiting, per hour', bound: false },
    { name: 'perKm', label: 'Typical rate per km', bound: true },
    { name: 'minPerKm', label: 'Lowest rate per km', bound: true },
    { name: 'maxPerKm', label: 'Highest rate per km', bound: true },
  ] as const;

  private readonly amount = [Validators.required, Validators.min(0)];

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(40)]],
    code: ['', [Validators.required, Validators.pattern(CODE_PATTERN), Validators.maxLength(30)]],
    description: [''],
    icon: [VehicleIcon.Sedan as VehicleIcon],
    seats: [4 as number | null, [Validators.required, Validators.min(1), Validators.max(60), wholeNumber]],
    luggageCapacity: [2 as number | null, [Validators.required, Validators.min(0), Validators.max(40), wholeNumber]],
    sortOrder: [10 as number | null, [Validators.required, wholeNumber]],
    isActive: [true],
    pricing: this.fb.nonNullable.group(
      {
        baseFare: [null as number | null, this.amount],
        perHourWaiting: [null as number | null, this.amount],
        perKm: [null as number | null, this.amount],
        minPerKm: [null as number | null, this.amount],
        maxPerKm: [null as number | null, this.amount],
      },
      { validators: pricingBoundsValidator },
    ),
  });

  ngOnInit(): void {
    const c = this.category();
    if (!c) return;
    this.form.reset({
      name: c.name,
      code: c.code,
      description: c.description ?? '',
      icon: c.icon,
      seats: c.seats,
      luggageCapacity: c.luggageCapacity,
      sortOrder: c.sortOrder,
      isActive: c.isActive,
      pricing: {
        baseFare: minorToRupees(c.pricing.baseFare.amountMinor),
        perHourWaiting: minorToRupees(c.pricing.perHourWaiting.amountMinor),
        perKm: minorToRupees(c.pricing.perKm.amountMinor),
        minPerKm: minorToRupees(c.pricing.minPerKm.amountMinor),
        maxPerKm: minorToRupees(c.pricing.maxPerKm.amountMinor),
      },
    });
    this.form.controls.code.disable();
  }

  protected save(): void {
    touchAll(this.form);
    this.form.controls.pricing.markAsDirty();
    if (this.form.invalid || this.busy()) {
      this.problem.set('Some details need fixing before this can be saved.');
      return;
    }
    const v = this.form.getRawValue();
    const body: Omit<VehicleCategory, 'id'> = {
      code: v.code,
      name: v.name.trim(),
      description: v.description.trim() || null,
      icon: v.icon,
      seats: Number(v.seats),
      luggageCapacity: Number(v.luggageCapacity),
      sortOrder: Number(v.sortOrder),
      isActive: v.isActive,
      pricing: {
        baseFare: money(v.pricing.baseFare),
        perHourWaiting: money(v.pricing.perHourWaiting),
        perKm: money(v.pricing.perKm),
        minPerKm: money(v.pricing.minPerKm),
        maxPerKm: money(v.pricing.maxPerKm),
      },
    };
    const existing = this.category();
    this.busy.set(true);
    this.problem.set('');
    (existing ? this.api.updateVehicleCategory(existing.id, body) : this.api.createVehicleCategory(body)).subscribe({
      next: (category) => {
        this.busy.set(false);
        this.toasts.success(existing ? `${category.name} updated.` : `${category.name} created.`);
        this.saved.emit(category);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.problem.set(applyServerErrors(this.form, error));
      },
    });
  }
}
