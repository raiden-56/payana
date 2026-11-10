import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  Currency,
  PackageArtwork,
  type Region,
  type TourPackage,
  type TourPackageInput,
  type VehicleCategory,
} from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { HumanizePipe, minorToRupees, rupeesToMinor } from '@core/util/format';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { PackageArt } from '@ui/package-art';
import { applyServerErrors, controlError, linesToList, listToLines, touchAll, wholeNumber } from '../shared/forms';
import { SLUG_PATTERN, slugify } from '../shared/rules';

/** Create or edit a sightseeing package: its route, stops, artwork and indicative prices. */
@Component({
  selector: 'app-admin-package-form',
  imports: [ReactiveFormsModule, Icon, PackageArt, HumanizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="a-editor" [formGroup]="form" (submit)="$event.preventDefault(); save()" novalidate>
      <header class="a-head">
        <div>
          <button type="button" class="a-back" (click)="cancelled.emit()"><app-icon name="arrow-left" [size]="16" /> Back to packages</button>
          <h1>{{ pkg() ? 'Edit ' + pkg()!.title : 'New tour package' }}</h1>
        </div>
      </header>

      <fieldset class="a-fieldset">
        <legend>Package</legend>
        <div class="split">
          <div class="form-grid">
            <div class="field span-2">
              <label class="field__label" for="pk-title">Title</label>
              <input id="pk-title" class="input" formControlName="title" maxlength="80" (input)="suggestSlug()" [attr.aria-invalid]="err(form.controls.title) ? 'true' : null" />
              @if (err(form.controls.title, 'Title'); as e) {
                <p class="field__error">{{ e }}</p>
              }
            </div>
            <div class="field">
              <label class="field__label" for="pk-slug">Web address key</label>
              <input id="pk-slug" class="input a-mono" formControlName="slug" maxlength="60" [attr.aria-invalid]="err(form.controls.slug) ? 'true' : null" />
              @if (err(form.controls.slug, 'The key'); as e) {
                <p class="field__error">{{ e }}</p>
              } @else {
                <p class="field__hint">Lower-case letters, digits and hyphens.</p>
              }
            </div>
            <div class="field">
              <label class="field__label" for="pk-region">Region</label>
              <select id="pk-region" class="select" formControlName="regionSlug" [attr.aria-invalid]="err(form.controls.regionSlug) ? 'true' : null">
                <option value="">Choose…</option>
                @for (r of regions(); track r.id) {
                  <option [value]="r.slug">{{ r.name }}</option>
                }
              </select>
              @if (err(form.controls.regionSlug, 'Region'); as e) {
                <p class="field__error">{{ e }}</p>
              }
            </div>
            <div class="field span-2">
              <label class="field__label" for="pk-summary">Summary</label>
              <textarea id="pk-summary" class="textarea" rows="3" formControlName="summary" maxlength="400" [attr.aria-invalid]="err(form.controls.summary) ? 'true' : null"></textarea>
              @if (err(form.controls.summary, 'Summary'); as e) {
                <p class="field__error">{{ e }}</p>
              }
            </div>
            <div class="field">
              <label class="field__label" for="pk-hours">Duration (hours)</label>
              <input id="pk-hours" class="input tabular" type="number" min="0.5" step="0.5" inputmode="decimal" formControlName="durationHours" [attr.aria-invalid]="err(form.controls.durationHours) ? 'true' : null" />
              @if (err(form.controls.durationHours, 'Duration'); as e) {
                <p class="field__error">{{ e }}</p>
              }
            </div>
            <div class="field">
              <label class="field__label" for="pk-km">Distance (km)</label>
              <input id="pk-km" class="input tabular" type="number" min="1" step="1" inputmode="numeric" formControlName="distanceKm" [attr.aria-invalid]="err(form.controls.distanceKm) ? 'true' : null" />
              @if (err(form.controls.distanceKm, 'Distance'); as e) {
                <p class="field__error">{{ e }}</p>
              }
            </div>
            <div class="field">
              <label class="field__label" for="pk-best">Best time <span class="field__optional">(optional)</span></label>
              <input id="pk-best" class="input" formControlName="bestTime" maxlength="80" placeholder="October to March, mornings" />
            </div>
            <div class="field">
              <label class="field__label" for="pk-sort">Position in lists</label>
              <input id="pk-sort" class="input tabular" type="number" step="1" formControlName="sortOrder" [attr.aria-invalid]="err(form.controls.sortOrder) ? 'true' : null" />
              @if (err(form.controls.sortOrder, 'Position'); as e) {
                <p class="field__error">{{ e }}</p>
              }
            </div>
          </div>
          <div class="art-pick">
            <div class="a-preview" aria-hidden="true"><app-package-art [artwork]="form.controls.artwork.value" /></div>
            <div class="field">
              <label class="field__label" for="pk-art">Artwork</label>
              <select id="pk-art" class="select" formControlName="artwork">
                @for (a of artworks; track a) {
                  <option [value]="a">{{ a | humanize }}</option>
                }
              </select>
            </div>
          </div>
        </div>
        <label class="switch live"><input type="checkbox" role="switch" formControlName="isActive" /><span></span> Shown to customers</label>
      </fieldset>

      <fieldset class="a-fieldset">
        <legend>Stops, in order</legend>
        <div formArrayName="stops">
          @for (stop of form.controls.stops.controls; track stop; let i = $index) {
            <div class="a-repeat" [formGroupName]="i">
              <div class="field">
                <label class="field__label" [for]="'st-name-' + i">Stop {{ i + 1 }}</label>
                <input class="input" [id]="'st-name-' + i" formControlName="name" maxlength="80" [attr.aria-invalid]="err(stop.controls.name) ? 'true' : null" />
                @if (err(stop.controls.name, 'Name'); as e) {
                  <p class="field__error">{{ e }}</p>
                }
              </div>
              <div class="field">
                <label class="field__label" [for]="'st-desc-' + i">What to see <span class="field__optional">(optional)</span></label>
                <input class="input" [id]="'st-desc-' + i" formControlName="description" maxlength="200" />
              </div>
              <div class="field">
                <label class="field__label" [for]="'st-min-' + i">Minutes</label>
                <input class="input tabular" type="number" min="5" step="5" inputmode="numeric" [id]="'st-min-' + i" formControlName="durationMinutes" [attr.aria-invalid]="err(stop.controls.durationMinutes) ? 'true' : null" />
              </div>
              <button type="button" class="btn btn--ghost btn--icon" [attr.aria-label]="'Remove stop ' + (i + 1)" (click)="form.controls.stops.removeAt(i)">
                <app-icon name="trash" [size]="18" />
              </button>
            </div>
          }
        </div>
        @if (triedStops() && !form.controls.stops.length) {
          <p class="field__error" role="alert"><app-icon name="alert-circle" [size]="14" /> Add at least one stop.</p>
        }
        <button type="button" class="btn btn--outline btn--sm" (click)="addStop()"><app-icon name="plus" [size]="15" /> Add a stop</button>
      </fieldset>

      <fieldset class="a-fieldset">
        <legend>Indicative prices (₹)</legend>
        <p class="a-sub">The lowest typical price per vehicle category. Shown as “from”, never as a fare.</p>
        <div formArrayName="priceFrom" style="--repeat-cols: 1.4fr 1fr">
          @for (row of form.controls.priceFrom.controls; track row; let i = $index) {
            <div class="a-repeat" [formGroupName]="i">
              <div class="field">
                <label class="field__label" [for]="'pf-cat-' + i">Vehicle category</label>
                <select class="select" [id]="'pf-cat-' + i" formControlName="categoryCode" [attr.aria-invalid]="err(row.controls.categoryCode) ? 'true' : null">
                  <option value="">Choose…</option>
                  @for (c of categories(); track c.id) {
                    <option [value]="c.code">{{ c.name }}</option>
                  }
                </select>
              </div>
              <div class="field">
                <label class="field__label" [for]="'pf-price-' + i">From</label>
                <div class="input-group">
                  <span class="input-group__addon" aria-hidden="true">₹</span>
                  <input class="input tabular" type="number" min="1" step="1" inputmode="decimal" [id]="'pf-price-' + i" formControlName="price" [attr.aria-invalid]="err(row.controls.price) ? 'true' : null" />
                </div>
              </div>
              <button type="button" class="btn btn--ghost btn--icon" [attr.aria-label]="'Remove price ' + (i + 1)" (click)="form.controls.priceFrom.removeAt(i)">
                <app-icon name="trash" [size]="18" />
              </button>
            </div>
          }
        </div>
        <button type="button" class="btn btn--outline btn--sm" (click)="addPrice()"><app-icon name="plus" [size]="15" /> Add a price</button>
      </fieldset>

      <fieldset class="a-fieldset">
        <legend>Highlights</legend>
        <div class="field">
          <label class="field__label" for="pk-highlights">Reasons to pick this tour</label>
          <textarea id="pk-highlights" class="textarea" rows="4" formControlName="highlights"></textarea>
          <p class="field__hint">One per line.</p>
        </div>
      </fieldset>

      <div class="a-editor__bar">
        @if (problem()) {
          <span class="a-editor__msg" role="alert">{{ problem() }}</span>
        }
        <button type="button" class="btn btn--ghost" [disabled]="busy()" (click)="cancelled.emit()">Cancel</button>
        <button type="submit" class="btn btn--dark" [class.is-loading]="busy()" [disabled]="busy()">{{ pkg() ? 'Save changes' : 'Create package' }}</button>
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
        grid-template-columns: minmax(0, 1fr) 16rem;
      }
    }
    .art-pick {
      display: grid;
      gap: 0.75rem;
    }
    .a-preview {
      padding: 0;
    }
    .a-preview app-package-art {
      width: 100%;
      aspect-ratio: 16 / 10;
    }
    .live {
      margin-top: 1.1rem;
    }
    .a-fieldset > .btn {
      margin-top: 0.25rem;
    }
  `,
})
export class PackageForm implements OnInit {
  /** The package being edited, or null to create one. */
  readonly pkg = input<TourPackage | null>(null);
  readonly regions = input.required<Region[]>();
  readonly categories = input.required<VehicleCategory[]>();
  readonly saved = output<TourPackage>();
  readonly cancelled = output<void>();

  private readonly api = inject(AdminApi);
  private readonly toasts = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly artworks = Object.values(PackageArtwork);
  protected readonly err = controlError;
  protected readonly busy = signal(false);
  protected readonly problem = signal('');
  protected readonly triedStops = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(80)]],
    slug: ['', [Validators.required, Validators.pattern(SLUG_PATTERN), Validators.maxLength(60)]],
    regionSlug: ['', [Validators.required]],
    summary: ['', [Validators.required, Validators.maxLength(400)]],
    artwork: [PackageArtwork.Beach as PackageArtwork],
    durationHours: [4 as number | null, [Validators.required, Validators.min(0.5), Validators.max(72)]],
    distanceKm: [20 as number | null, [Validators.required, Validators.min(1), Validators.max(2000)]],
    bestTime: [''],
    sortOrder: [10 as number | null, [Validators.required, wholeNumber]],
    isActive: [true],
    highlights: [''],
    stops: this.fb.array([this.stopGroup()]),
    priceFrom: this.fb.array([this.priceGroup()]),
  });

  ngOnInit(): void {
    const p = this.pkg();
    if (!p) return;
    this.form.controls.stops.clear();
    p.stops.forEach((s) => this.form.controls.stops.push(this.stopGroup(s.name, s.description ?? '', s.durationMinutes)));
    this.form.controls.priceFrom.clear();
    p.priceFrom.forEach((r) => this.form.controls.priceFrom.push(this.priceGroup(r.categoryCode, minorToRupees(r.price.amountMinor))));
    this.form.patchValue({
      title: p.title,
      slug: p.slug,
      regionSlug: p.regionSlug,
      summary: p.summary,
      artwork: p.artwork,
      durationHours: p.durationHours,
      distanceKm: p.distanceKm,
      bestTime: p.bestTime ?? '',
      sortOrder: p.sortOrder,
      isActive: p.isActive,
      highlights: listToLines(p.highlights),
    });
  }

  private stopGroup(name = '', description = '', minutes: number | null = 30) {
    return this.fb.nonNullable.group({
      name: [name, [Validators.required, Validators.maxLength(80)]],
      description: [description],
      durationMinutes: [minutes, [Validators.required, Validators.min(5), wholeNumber]],
    });
  }

  private priceGroup(categoryCode = '', price: number | null = null) {
    return this.fb.nonNullable.group({
      categoryCode: [categoryCode, [Validators.required]],
      price: [price, [Validators.required, Validators.min(1)]],
    });
  }

  protected addStop(): void {
    this.form.controls.stops.push(this.stopGroup());
  }

  protected addPrice(): void {
    this.form.controls.priceFrom.push(this.priceGroup());
  }

  /** While creating, the key follows the title until the administrator edits it. */
  protected suggestSlug(): void {
    const slug = this.form.controls.slug;
    if (!this.pkg() && !slug.dirty) slug.setValue(slugify(this.form.controls.title.value));
  }

  protected save(): void {
    touchAll(this.form);
    this.triedStops.set(true);
    if (this.form.invalid || !this.form.controls.stops.length || this.busy()) {
      this.problem.set('Some details need fixing before this can be saved.');
      return;
    }
    const v = this.form.getRawValue();
    const names = new Map(this.categories().map((c) => [c.code, c.name]));
    const body: TourPackageInput = {
      slug: v.slug,
      title: v.title.trim(),
      summary: v.summary.trim(),
      regionSlug: v.regionSlug,
      artwork: v.artwork,
      durationHours: Number(v.durationHours),
      distanceKm: Number(v.distanceKm),
      bestTime: v.bestTime.trim() || null,
      sortOrder: Number(v.sortOrder),
      isActive: v.isActive,
      highlights: linesToList(v.highlights),
      stops: v.stops.map((s) => ({
        name: s.name.trim(),
        description: s.description.trim() || null,
        durationMinutes: Number(s.durationMinutes),
      })),
      priceFrom: v.priceFrom.map((r) => ({
        categoryCode: r.categoryCode,
        categoryName: names.get(r.categoryCode) ?? r.categoryCode,
        price: { amountMinor: rupeesToMinor(r.price) ?? 0, currency: Currency.INR },
      })),
    };
    const existing = this.pkg();
    this.busy.set(true);
    this.problem.set('');
    (existing ? this.api.updatePackage(existing.id, body) : this.api.createPackage(body)).subscribe({
      next: (saved) => {
        this.busy.set(false);
        this.toasts.success(existing ? `${saved.title} updated.` : `${saved.title} created.`);
        this.saved.emit(saved);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.problem.set(applyServerErrors(this.form, error));
      },
    });
  }
}
