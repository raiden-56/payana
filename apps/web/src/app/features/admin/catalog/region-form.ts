import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RegionStatus, type Region } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { ToastService } from '@core/util/toast.service';
import { Modal } from '@ui/primitives';
import { statusLabel } from '@ui/status';
import { applyServerErrors, controlError, touchAll } from '../shared/forms';
import { SLUG_PATTERN, slugify } from '../shared/rules';

/** Add or edit a town / service area. Opening a new market is this form, not a release. */
@Component({
  selector: 'app-admin-region-form',
  imports: [ReactiveFormsModule, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [open]="open()" [title]="region() ? 'Edit ' + region()!.name : 'Add a region'" (closed)="closed.emit()">
      <form id="region-form" class="form-grid" [formGroup]="form" (submit)="$event.preventDefault(); save()" novalidate>
        <div class="field">
          <label class="field__label" for="rg-name">Name</label>
          <input id="rg-name" class="input" formControlName="name" maxlength="60" (input)="suggestSlug()" [attr.aria-invalid]="err(form.controls.name) ? 'true' : null" />
          @if (err(form.controls.name, 'Name'); as e) {
            <p class="field__error">{{ e }}</p>
          }
        </div>
        <div class="field">
          <label class="field__label" for="rg-local">Name in Kannada <span class="field__optional">(optional)</span></label>
          <input id="rg-local" class="input kn" lang="kn" formControlName="nameLocal" maxlength="60" />
        </div>
        <div class="field">
          <label class="field__label" for="rg-slug">Web address key</label>
          <input id="rg-slug" class="input a-mono" formControlName="slug" maxlength="40" aria-describedby="rg-slug-help" [attr.aria-invalid]="err(form.controls.slug) ? 'true' : null" />
          @if (err(form.controls.slug, 'The key'); as e) {
            <p class="field__error">{{ e }}</p>
          } @else {
            <p class="field__hint" id="rg-slug-help">
              {{ region() ? 'Fixed once created; links and listings depend on it.' : 'Lower-case letters, digits and hyphens, e.g. "kumta".' }}
            </p>
          }
        </div>
        <div class="field">
          <label class="field__label" for="rg-state">State</label>
          <input id="rg-state" class="input" formControlName="state" maxlength="60" [attr.aria-invalid]="err(form.controls.state) ? 'true' : null" />
          @if (err(form.controls.state, 'State'); as e) {
            <p class="field__error">{{ e }}</p>
          }
        </div>
        <div class="field">
          <label class="field__label" for="rg-lat">Centre latitude</label>
          <input id="rg-lat" class="input tabular" type="number" step="0.0001" inputmode="decimal" formControlName="lat" [attr.aria-invalid]="err(form.controls.lat) ? 'true' : null" />
          @if (err(form.controls.lat, 'Latitude'); as e) {
            <p class="field__error">{{ e }}</p>
          }
        </div>
        <div class="field">
          <label class="field__label" for="rg-lng">Centre longitude</label>
          <input id="rg-lng" class="input tabular" type="number" step="0.0001" inputmode="decimal" formControlName="lng" [attr.aria-invalid]="err(form.controls.lng) ? 'true' : null" />
          @if (err(form.controls.lng, 'Longitude'); as e) {
            <p class="field__error">{{ e }}</p>
          }
        </div>
        <div class="field">
          <label class="field__label" for="rg-radius">Radius (km)</label>
          <input id="rg-radius" class="input tabular" type="number" step="1" inputmode="numeric" formControlName="radiusKm" aria-describedby="rg-radius-help" [attr.aria-invalid]="err(form.controls.radiusKm) ? 'true' : null" />
          @if (err(form.controls.radiusKm, 'Radius'); as e) {
            <p class="field__error">{{ e }}</p>
          } @else {
            <p class="field__hint" id="rg-radius-help">Points within this distance of the centre count as inside the region.</p>
          }
        </div>
        <div class="field">
          <label class="field__label" for="rg-status">Status</label>
          <select id="rg-status" class="select" formControlName="status">
            @for (s of statuses; track s) {
              <option [value]="s">{{ label(s) }}</option>
            }
          </select>
        </div>
        <div class="field span-2">
          <label class="field__label" for="rg-tagline">Tagline <span class="field__optional">(optional)</span></label>
          <input id="rg-tagline" class="input" formControlName="tagline" maxlength="140" placeholder="Beaches, temples and the road to Om" />
        </div>
        @if (problem()) {
          <p class="notice notice--danger span-2" role="alert">{{ problem() }}</p>
        }
      </form>
      <ng-container modalActions>
        <button type="button" class="btn btn--ghost" [disabled]="busy()" (click)="closed.emit()">Cancel</button>
        <button type="submit" form="region-form" class="btn btn--dark" [class.is-loading]="busy()" [disabled]="busy()">
          {{ region() ? 'Save changes' : 'Add region' }}
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class RegionForm {
  readonly open = input(false);
  /** The region being edited, or null to create one. */
  readonly region = input<Region | null>(null);
  readonly saved = output<Region>();
  readonly closed = output<void>();

  private readonly api = inject(AdminApi);
  private readonly toasts = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly statuses = Object.values(RegionStatus);
  protected readonly err = controlError;
  protected readonly busy = signal(false);
  protected readonly problem = signal('');

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    nameLocal: [''],
    slug: ['', [Validators.required, Validators.pattern(SLUG_PATTERN), Validators.maxLength(40)]],
    state: ['Karnataka', [Validators.required]],
    lat: [null as number | null, [Validators.required, Validators.min(-90), Validators.max(90)]],
    lng: [null as number | null, [Validators.required, Validators.min(-180), Validators.max(180)]],
    radiusKm: [15 as number | null, [Validators.required, Validators.min(1), Validators.max(100)]],
    status: [RegionStatus.ComingSoon as RegionStatus],
    tagline: [''],
  });

  constructor() {
    // Each time the dialog opens, start from the region being edited (or blank).
    effect(() => {
      if (!this.open()) return;
      const r = this.region();
      this.problem.set('');
      this.form.reset({
        name: r?.name ?? '',
        nameLocal: r?.nameLocal ?? '',
        slug: r?.slug ?? '',
        state: r?.state ?? 'Karnataka',
        lat: r?.center.lat ?? null,
        lng: r?.center.lng ?? null,
        radiusKm: r?.radiusKm ?? 15,
        status: r?.status ?? RegionStatus.ComingSoon,
        tagline: r?.tagline ?? '',
      });
      if (r) this.form.controls.slug.disable();
      else this.form.controls.slug.enable();
    });
  }

  protected label(status: string): string {
    return statusLabel('region', status);
  }

  /** While creating, the key follows the name until the administrator edits it. */
  protected suggestSlug(): void {
    const slug = this.form.controls.slug;
    if (!this.region() && !slug.dirty) slug.setValue(slugify(this.form.controls.name.value));
  }

  protected save(): void {
    touchAll(this.form);
    if (this.form.invalid || this.busy()) return;
    const v = this.form.getRawValue();
    const body: Omit<Region, 'id'> = {
      slug: v.slug,
      name: v.name.trim(),
      nameLocal: v.nameLocal.trim() || null,
      state: v.state.trim(),
      center: { lat: Number(v.lat), lng: Number(v.lng) },
      radiusKm: Number(v.radiusKm),
      status: v.status,
      tagline: v.tagline.trim() || null,
    };
    const existing = this.region();
    this.busy.set(true);
    this.problem.set('');
    (existing ? this.api.updateRegion(existing.id, body) : this.api.createRegion(body)).subscribe({
      next: (region) => {
        this.busy.set(false);
        this.toasts.success(existing ? `${region.name} updated.` : `${region.name} added.`);
        this.saved.emit(region);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.problem.set(applyServerErrors(this.form, error));
      },
    });
  }
}
