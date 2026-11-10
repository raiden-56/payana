import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdPlacement, type AdCampaign, type AdCampaignInput, type Region } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { HumanizePipe } from '@core/util/format';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { applyServerErrors, controlError, todayIso, touchAll, wholeNumber } from '../shared/forms';
import { ctaUrlValidator, dateOrderValidator, httpsUrlValidator } from '../shared/rules';

type EditableStatus = AdCampaignInput['status'];

/** The editable fields of a campaign, from a saved one. Shared with the pause / resume buttons. */
export function toCampaignInput(c: AdCampaign, status: EditableStatus): AdCampaignInput {
  return {
    advertiserName: c.advertiserName,
    advertiserContact: c.advertiserContact,
    title: c.title,
    body: c.body,
    imageUrl: c.imageUrl,
    ctaLabel: c.ctaLabel,
    ctaUrl: c.ctaUrl,
    placements: c.placements,
    regionSlugs: c.regionSlugs,
    startsOn: c.startsOn,
    endsOn: c.endsOn,
    weight: c.weight,
    status,
  };
}

/** Create or edit a local-business advertising campaign. */
@Component({
  selector: 'app-admin-campaign-form',
  imports: [ReactiveFormsModule, Icon, HumanizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="a-editor" [formGroup]="form" (submit)="$event.preventDefault(); save()" novalidate>
      <header class="a-head">
        <div>
          <button type="button" class="a-back" (click)="cancelled.emit()"><app-icon name="arrow-left" [size]="16" /> Back to campaigns</button>
          <h1>{{ campaign() ? 'Edit campaign' : 'New campaign' }}</h1>
        </div>
      </header>

      <fieldset class="a-fieldset">
        <legend>Advertiser</legend>
        <div class="form-grid">
          <div class="field">
            <label class="field__label" for="ad-name">Business name</label>
            <input id="ad-name" class="input" formControlName="advertiserName" maxlength="80" [attr.aria-invalid]="err(form.controls.advertiserName) ? 'true' : null" />
            @if (err(form.controls.advertiserName, 'Business name'); as e) {
              <p class="field__error">{{ e }}</p>
            }
          </div>
          <div class="field">
            <label class="field__label" for="ad-contact">Contact for billing <span class="field__optional">(optional)</span></label>
            <input id="ad-contact" class="input" formControlName="advertiserContact" maxlength="120" />
            <p class="field__hint">Internal only; never shown to the public.</p>
          </div>
        </div>
      </fieldset>

      <fieldset class="a-fieldset">
        <legend>Advertisement</legend>
        <div class="form-grid">
          <div class="field span-2">
            <label class="field__label" for="ad-title">Headline</label>
            <input id="ad-title" class="input" formControlName="title" maxlength="70" [attr.aria-invalid]="err(form.controls.title) ? 'true' : null" />
            @if (err(form.controls.title, 'Headline'); as e) {
              <p class="field__error">{{ e }}</p>
            }
          </div>
          <div class="field span-2">
            <label class="field__label" for="ad-body">Text</label>
            <textarea id="ad-body" class="textarea" rows="3" formControlName="body" maxlength="200" [attr.aria-invalid]="err(form.controls.body) ? 'true' : null"></textarea>
            @if (err(form.controls.body, 'Text'); as e) {
              <p class="field__error">{{ e }}</p>
            }
          </div>
          <div class="field">
            <label class="field__label" for="ad-cta">Button label</label>
            <input id="ad-cta" class="input" formControlName="ctaLabel" maxlength="24" placeholder="Call now" [attr.aria-invalid]="err(form.controls.ctaLabel) ? 'true' : null" />
            @if (err(form.controls.ctaLabel, 'Button label'); as e) {
              <p class="field__error">{{ e }}</p>
            }
          </div>
          <div class="field">
            <label class="field__label" for="ad-url">Button opens</label>
            <input id="ad-url" class="input" type="url" formControlName="ctaUrl" placeholder="https://… or tel:+91…" [attr.aria-invalid]="err(form.controls.ctaUrl) ? 'true' : null" />
            @if (err(form.controls.ctaUrl, 'The link'); as e) {
              <p class="field__error">{{ e }}</p>
            } @else {
              <p class="field__hint">A secure web page (https) or a phone number (tel:).</p>
            }
          </div>
          <div class="field span-2">
            <label class="field__label" for="ad-image">Image address <span class="field__optional">(optional)</span></label>
            <input id="ad-image" class="input" type="url" formControlName="imageUrl" placeholder="https://…" [attr.aria-invalid]="err(form.controls.imageUrl) ? 'true' : null" />
            @if (err(form.controls.imageUrl, 'The image address'); as e) {
              <p class="field__error">{{ e }}</p>
            }
          </div>
        </div>
      </fieldset>

      <fieldset class="a-fieldset">
        <legend>Where it appears</legend>
        <div class="a-checks" role="group" aria-label="Placements">
          @for (p of placements; track p) {
            <label class="check">
              <input type="checkbox" [checked]="picked().has(p)" (change)="togglePlacement(p)" />
              <span>{{ p | humanize }}</span>
            </label>
          }
        </div>
        @if (tried() && !picked().size) {
          <p class="field__error" role="alert"><app-icon name="alert-circle" [size]="14" /> Choose at least one placement.</p>
        }
        <p class="a-sub regions-title">Regions <span class="field__optional">(none ticked = every region)</span></p>
        <div class="a-checks" role="group" aria-label="Regions">
          @for (r of regions(); track r.id) {
            <label class="check">
              <input type="checkbox" [checked]="pickedRegions().has(r.slug)" (change)="toggleRegion(r.slug)" />
              <span>{{ r.name }}</span>
            </label>
          }
        </div>
      </fieldset>

      <fieldset class="a-fieldset" formGroupName="schedule">
        <legend>Schedule</legend>
        <div class="form-grid">
          <div class="field">
            <label class="field__label" for="ad-start">Starts on</label>
            <input id="ad-start" class="input" type="date" formControlName="startsOn" [attr.aria-invalid]="err(sched.startsOn) ? 'true' : null" />
            @if (err(sched.startsOn, 'Start date'); as e) {
              <p class="field__error">{{ e }}</p>
            }
          </div>
          <div class="field">
            <label class="field__label" for="ad-end">Ends on</label>
            <input id="ad-end" class="input" type="date" formControlName="endsOn" [attr.aria-invalid]="err(sched.endsOn) || err(form.controls.schedule) ? 'true' : null" />
            @if (err(sched.endsOn, 'End date') || err(form.controls.schedule); as e) {
              <p class="field__error">{{ e }}</p>
            }
          </div>
        </div>
      </fieldset>

      <fieldset class="a-fieldset">
        <legend>Delivery</legend>
        <div class="form-grid">
          <div class="field">
            <label class="field__label" for="ad-status">State</label>
            <select id="ad-status" class="select" formControlName="status">
              <option value="draft">Draft — not shown</option>
              <option value="scheduled">Scheduled — runs between its dates</option>
              <option value="paused">Paused — not shown</option>
            </select>
          </div>
          <div class="field">
            <label class="field__label" for="ad-weight">Weight (1–10)</label>
            <input id="ad-weight" class="input tabular" type="number" min="1" max="10" step="1" inputmode="numeric" formControlName="weight" [attr.aria-invalid]="err(form.controls.weight) ? 'true' : null" />
            @if (err(form.controls.weight, 'Weight'); as e) {
              <p class="field__error">{{ e }}</p>
            } @else {
              <p class="field__hint">Share of impressions against other campaigns in the same position.</p>
            }
          </div>
        </div>
      </fieldset>

      <div class="a-editor__bar">
        @if (problem()) {
          <span class="a-editor__msg" role="alert">{{ problem() }}</span>
        }
        <button type="button" class="btn btn--ghost" [disabled]="busy()" (click)="cancelled.emit()">Cancel</button>
        <button type="submit" class="btn btn--dark" [class.is-loading]="busy()" [disabled]="busy()">{{ campaign() ? 'Save changes' : 'Create campaign' }}</button>
      </div>
    </form>
  `,
  styles: `
    .regions-title {
      margin-block: 1.1rem 0.6rem;
      font-weight: 650;
      color: var(--ink-800);
    }
  `,
})
export class CampaignForm implements OnInit {
  /** The campaign being edited, or null to create one. */
  readonly campaign = input<AdCampaign | null>(null);
  readonly regions = input.required<Region[]>();
  readonly saved = output<AdCampaign>();
  readonly cancelled = output<void>();

  private readonly api = inject(AdminApi);
  private readonly toasts = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly placements = Object.values(AdPlacement);
  protected readonly err = controlError;
  protected readonly busy = signal(false);
  protected readonly problem = signal('');
  protected readonly tried = signal(false);
  protected readonly picked = signal<ReadonlySet<AdPlacement>>(new Set([AdPlacement.HomeStrip]));
  protected readonly pickedRegions = signal<ReadonlySet<string>>(new Set());

  protected readonly form = this.fb.nonNullable.group({
    advertiserName: ['', [Validators.required, Validators.maxLength(80)]],
    advertiserContact: [''],
    title: ['', [Validators.required, Validators.maxLength(70)]],
    body: ['', [Validators.required, Validators.maxLength(200)]],
    ctaLabel: ['', [Validators.required, Validators.maxLength(24)]],
    ctaUrl: ['', [Validators.required, ctaUrlValidator]],
    imageUrl: ['', [httpsUrlValidator]],
    status: ['draft' as EditableStatus],
    weight: [5 as number | null, [Validators.required, Validators.min(1), Validators.max(10), wholeNumber]],
    schedule: this.fb.nonNullable.group(
      { startsOn: [todayIso(), [Validators.required]], endsOn: ['', [Validators.required]] },
      { validators: dateOrderValidator },
    ),
  });
  protected readonly sched = this.form.controls.schedule.controls;

  ngOnInit(): void {
    const c = this.campaign();
    if (!c) return;
    this.picked.set(new Set(c.placements));
    this.pickedRegions.set(new Set(c.regionSlugs));
    this.form.reset({
      advertiserName: c.advertiserName,
      advertiserContact: c.advertiserContact ?? '',
      title: c.title,
      body: c.body,
      ctaLabel: c.ctaLabel,
      ctaUrl: c.ctaUrl,
      imageUrl: c.imageUrl ?? '',
      // "running" and "ended" are computed by the server from the dates; editing keeps it eligible to run.
      status: c.status === 'draft' || c.status === 'paused' ? c.status : 'scheduled',
      weight: c.weight,
      schedule: { startsOn: c.startsOn, endsOn: c.endsOn },
    });
  }

  protected togglePlacement(p: AdPlacement): void {
    this.picked.update((set) => toggled(set, p));
  }

  protected toggleRegion(slug: string): void {
    this.pickedRegions.update((set) => toggled(set, slug));
  }

  protected save(): void {
    touchAll(this.form);
    this.tried.set(true);
    if (this.form.invalid || !this.picked().size || this.busy()) {
      this.problem.set('Some details need fixing before this can be saved.');
      return;
    }
    const v = this.form.getRawValue();
    const body: AdCampaignInput = {
      advertiserName: v.advertiserName.trim(),
      advertiserContact: v.advertiserContact.trim() || null,
      title: v.title.trim(),
      body: v.body.trim(),
      ctaLabel: v.ctaLabel.trim(),
      ctaUrl: v.ctaUrl.trim(),
      imageUrl: v.imageUrl.trim() || null,
      placements: [...this.picked()],
      regionSlugs: [...this.pickedRegions()],
      startsOn: v.schedule.startsOn,
      endsOn: v.schedule.endsOn,
      weight: Number(v.weight),
      status: v.status,
    };
    const existing = this.campaign();
    this.busy.set(true);
    this.problem.set('');
    (existing ? this.api.updateAdCampaign(existing.id, body) : this.api.createAdCampaign(body)).subscribe({
      next: (saved) => {
        this.busy.set(false);
        this.toasts.success(existing ? 'Campaign updated.' : 'Campaign created.');
        this.saved.emit(saved);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.problem.set(applyServerErrors(this.form, error));
      },
    });
  }
}

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
