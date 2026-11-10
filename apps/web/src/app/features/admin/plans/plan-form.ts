import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BillingPeriod, Currency, type SubscriptionPlan, type SubscriptionPlanInput } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { HumanizePipe, minorToRupees, rupeesToMinor } from '@core/util/format';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { applyServerErrors, controlError, linesToList, listToLines, touchAll, wholeNumber } from '../shared/forms';
import { CODE_PATTERN } from '../shared/rules';

/** Create or edit a driver subscription plan and what it entitles the partner to. */
@Component({
  selector: 'app-admin-plan-form',
  imports: [ReactiveFormsModule, Icon, HumanizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="a-editor" [formGroup]="form" (submit)="$event.preventDefault(); save()" novalidate>
      <header class="a-head">
        <div>
          <button type="button" class="a-back" (click)="cancelled.emit()"><app-icon name="arrow-left" [size]="16" /> Back to plans</button>
          <h1>{{ plan() ? 'Edit ' + plan()!.name : 'New plan' }}</h1>
        </div>
      </header>

      <fieldset class="a-fieldset">
        <legend>Plan</legend>
        <div class="form-grid">
          <div class="field">
            <label class="field__label" for="pl-name">Name</label>
            <input id="pl-name" class="input" formControlName="name" maxlength="40" [attr.aria-invalid]="err(form.controls.name) ? 'true' : null" />
            @if (err(form.controls.name, 'Name'); as e) {
              <p class="field__error">{{ e }}</p>
            }
          </div>
          <div class="field">
            <label class="field__label" for="pl-code">Code</label>
            <input id="pl-code" class="input a-mono" formControlName="code" maxlength="30" [attr.aria-invalid]="err(form.controls.code) ? 'true' : null" />
            @if (err(form.controls.code, 'Code'); as e) {
              <p class="field__error">{{ e }}</p>
            } @else {
              <p class="field__hint">{{ plan() ? 'Fixed once created.' : 'Lower-case, e.g. "plus".' }}</p>
            }
          </div>
          <div class="field span-2">
            <label class="field__label" for="pl-desc">Description</label>
            <input id="pl-desc" class="input" formControlName="description" maxlength="160" [attr.aria-invalid]="err(form.controls.description) ? 'true' : null" />
            @if (err(form.controls.description, 'Description'); as e) {
              <p class="field__error">{{ e }}</p>
            }
          </div>
          <div class="field">
            <label class="field__label" for="pl-price">Price</label>
            <div class="input-group">
              <span class="input-group__addon" aria-hidden="true">₹</span>
              <input id="pl-price" class="input tabular" type="number" min="0" step="1" inputmode="decimal" formControlName="price" [attr.aria-invalid]="err(form.controls.price) ? 'true' : null" />
            </div>
            @if (err(form.controls.price, 'Price'); as e) {
              <p class="field__error">{{ e }}</p>
            } @else {
              <p class="field__hint">Use 0 for a free plan.</p>
            }
          </div>
          <div class="field">
            <label class="field__label" for="pl-period">Billed</label>
            <select id="pl-period" class="select" formControlName="billingPeriod">
              @for (p of periods; track p) {
                <option [value]="p">{{ p | humanize }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label class="field__label" for="pl-sort">Position in lists</label>
            <input id="pl-sort" class="input tabular" type="number" step="1" formControlName="sortOrder" [attr.aria-invalid]="err(form.controls.sortOrder) ? 'true' : null" />
            @if (err(form.controls.sortOrder, 'Position'); as e) {
              <p class="field__error">{{ e }}</p>
            }
          </div>
        </div>
        <div class="a-checks toggles">
          <label class="switch"><input type="checkbox" role="switch" formControlName="isActive" /><span></span> Available to buy</label>
          <label class="switch"><input type="checkbox" role="switch" formControlName="isRecommended" /><span></span> Highlight as recommended</label>
        </div>
      </fieldset>

      <fieldset class="a-fieldset" formGroupName="entitlements">
        <legend>What the plan includes</legend>
        <div class="form-grid">
          <div class="field">
            <label class="field__label" for="pl-vehicles">Vehicles that can be listed</label>
            <input id="pl-vehicles" class="input tabular" type="number" min="1" step="1" inputmode="numeric" formControlName="maxVehicles" [attr.aria-invalid]="err(ent.maxVehicles) ? 'true' : null" />
            @if (err(ent.maxVehicles, 'This'); as e) {
              <p class="field__error">{{ e }}</p>
            }
          </div>
          <div class="field">
            <label class="field__label" for="pl-featured">Featured days per period</label>
            <input id="pl-featured" class="input tabular" type="number" min="0" step="1" inputmode="numeric" formControlName="featuredDaysIncluded" [attr.aria-invalid]="err(ent.featuredDaysIncluded) ? 'true' : null" />
            @if (err(ent.featuredDaysIncluded, 'This'); as e) {
              <p class="field__error">{{ e }}</p>
            }
          </div>
          <div class="field">
            <label class="field__label" for="pl-quotes">Quotes per month</label>
            <input id="pl-quotes" class="input tabular" type="number" min="1" step="1" inputmode="numeric" formControlName="monthlyQuoteLimit" [attr.aria-invalid]="err(ent.monthlyQuoteLimit) ? 'true' : null" />
            @if (err(ent.monthlyQuoteLimit, 'The limit'); as e) {
              <p class="field__error">{{ e }}</p>
            }
            <label class="check unlimited">
              <input type="checkbox" formControlName="unlimitedQuotes" (change)="syncQuoteLimit()" />
              <span>Unlimited quotes</span>
            </label>
          </div>
          <div class="field">
            <label class="field__label" for="pl-badge">Badge on the listing <span class="field__optional">(optional)</span></label>
            <input id="pl-badge" class="input" formControlName="badge" maxlength="12" placeholder="Pro" />
            <p class="field__hint">Short word shown beside the driver's name.</p>
          </div>
        </div>
        <div class="a-checks toggles">
          <label class="switch"><input type="checkbox" role="switch" formControlName="priorityInSearch" /><span></span> Ranked ahead of free listings</label>
          <label class="switch"><input type="checkbox" role="switch" formControlName="analytics" /><span></span> Performance dashboard</label>
        </div>
      </fieldset>

      <fieldset class="a-fieldset">
        <legend>Selling points</legend>
        <div class="field">
          <label class="field__label" for="pl-highlights">Shown on the pricing page</label>
          <textarea id="pl-highlights" class="textarea" rows="5" formControlName="highlights" aria-describedby="pl-highlights-help"></textarea>
          <p class="field__hint" id="pl-highlights-help">One per line.</p>
        </div>
      </fieldset>

      <div class="a-editor__bar">
        @if (problem()) {
          <span class="a-editor__msg" role="alert">{{ problem() }}</span>
        }
        <button type="button" class="btn btn--ghost" [disabled]="busy()" (click)="cancelled.emit()">Cancel</button>
        <button type="submit" class="btn btn--dark" [class.is-loading]="busy()" [disabled]="busy()">{{ plan() ? 'Save changes' : 'Create plan' }}</button>
      </div>
    </form>
  `,
  styles: `
    .toggles {
      margin-top: 1.1rem;
    }
    .unlimited {
      margin-top: 0.4rem;
      font-size: var(--fs-sm);
    }
  `,
})
export class PlanForm implements OnInit {
  /** The plan being edited, or null to create one. */
  readonly plan = input<SubscriptionPlan | null>(null);
  readonly saved = output<SubscriptionPlan>();
  readonly cancelled = output<void>();

  private readonly api = inject(AdminApi);
  private readonly toasts = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly periods = Object.values(BillingPeriod);
  protected readonly err = controlError;
  protected readonly busy = signal(false);
  protected readonly problem = signal('');

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(40)]],
    code: ['', [Validators.required, Validators.pattern(CODE_PATTERN), Validators.maxLength(30)]],
    description: ['', [Validators.required, Validators.maxLength(160)]],
    price: [0 as number | null, [Validators.required, Validators.min(0)]],
    billingPeriod: [BillingPeriod.Monthly as BillingPeriod],
    sortOrder: [10 as number | null, [Validators.required, wholeNumber]],
    isActive: [true],
    isRecommended: [false],
    highlights: [''],
    entitlements: this.fb.nonNullable.group({
      maxVehicles: [1 as number | null, [Validators.required, Validators.min(1), wholeNumber]],
      featuredDaysIncluded: [0 as number | null, [Validators.required, Validators.min(0), wholeNumber]],
      monthlyQuoteLimit: [null as number | null, [Validators.min(1), wholeNumber]],
      unlimitedQuotes: [true],
      badge: [''],
      priorityInSearch: [false],
      analytics: [false],
    }),
  });
  protected readonly ent = this.form.controls.entitlements.controls;

  ngOnInit(): void {
    const p = this.plan();
    if (p) {
      this.form.reset({
        name: p.name,
        code: p.code,
        description: p.description,
        price: minorToRupees(p.price.amountMinor),
        billingPeriod: p.billingPeriod,
        sortOrder: p.sortOrder,
        isActive: p.isActive,
        isRecommended: p.isRecommended,
        highlights: listToLines(p.highlights),
        entitlements: {
          maxVehicles: p.entitlements.maxVehicles,
          featuredDaysIncluded: p.entitlements.featuredDaysIncluded,
          monthlyQuoteLimit: p.entitlements.monthlyQuoteLimit,
          unlimitedQuotes: p.entitlements.monthlyQuoteLimit === null,
          badge: p.entitlements.badge ?? '',
          priorityInSearch: p.entitlements.priorityInSearch,
          analytics: p.entitlements.analytics,
        },
      });
      this.form.controls.code.disable();
    }
    this.syncQuoteLimit();
  }

  /** "Unlimited" and a number are mutually exclusive; a limit is required when it is not unlimited. */
  protected syncQuoteLimit(): void {
    const limit = this.ent.monthlyQuoteLimit;
    if (this.ent.unlimitedQuotes.value) {
      limit.setValue(null);
      limit.disable();
    } else {
      limit.enable();
      limit.setValidators([Validators.required, Validators.min(1), wholeNumber]);
      limit.updateValueAndValidity();
    }
  }

  protected save(): void {
    touchAll(this.form);
    if (this.form.invalid || this.busy()) {
      this.problem.set('Some details need fixing before this can be saved.');
      return;
    }
    const v = this.form.getRawValue();
    const e = v.entitlements;
    const body: SubscriptionPlanInput = {
      code: v.code,
      name: v.name.trim(),
      description: v.description.trim(),
      price: { amountMinor: rupeesToMinor(v.price) ?? 0, currency: Currency.INR },
      billingPeriod: v.billingPeriod,
      sortOrder: Number(v.sortOrder),
      isActive: v.isActive,
      isRecommended: v.isRecommended,
      highlights: linesToList(v.highlights),
      entitlements: {
        maxVehicles: Number(e.maxVehicles),
        featuredDaysIncluded: Number(e.featuredDaysIncluded),
        monthlyQuoteLimit: e.unlimitedQuotes ? null : Number(e.monthlyQuoteLimit),
        priorityInSearch: e.priorityInSearch,
        badge: e.badge.trim() || null,
        analytics: e.analytics,
      },
    };
    const existing = this.plan();
    this.busy.set(true);
    this.problem.set('');
    (existing ? this.api.updatePlan(existing.id, body) : this.api.createPlan(body)).subscribe({
      next: (plan) => {
        this.busy.set(false);
        this.toasts.success(existing ? `${plan.name} updated.` : `${plan.name} created.`);
        this.saved.emit(plan);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.problem.set(applyServerErrors(this.form, error));
      },
    });
  }
}
