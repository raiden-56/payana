import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { startWith, tap } from 'rxjs';
import {
  ADSENSE_PUBLISHER_ID_PATTERN,
  ADSENSE_SLOT_ID_PATTERN,
  AdPlacement,
  ConversionEvent,
  FeatureFlag,
  GA4_MEASUREMENT_ID_PATTERN,
  GOOGLE_ADS_CONVERSION_LABEL_PATTERN,
  GOOGLE_ADS_ID_PATTERN,
  INDIAN_MOBILE_E164,
  Permission,
  type PlatformSettings,
  type Region,
} from '@payana/contracts';
import { AnalyticsService, type IntegrationState } from '@core/analytics/analytics.service';
import { ConsentStore } from '@core/analytics/consent.store';
import { AdminApi } from '@core/api/admin.api';
import { CatalogApi } from '@core/api/public.api';
import { ApiError, toApiError } from '@core/api/api-error';
import { AuthStore } from '@core/auth/auth.store';
import { BRAND } from '@core/brand';
import { AppConfigService } from '@core/config/app-config.service';
import { formatMoney, rupeesToMinor } from '@core/util/format';
import { loader } from '@core/util/loader';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { StatePanel } from '@ui/primitives';

/** Valid when empty (= integration off) or when it matches the pattern. */
function emptyOr(pattern: RegExp): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '').trim();
    return !value || pattern.test(value) ? null : { format: true };
  };
}

const text = (validators: ValidatorFn[] = []) => new FormControl('', { nonNullable: true, validators });
const flag = (initial = false) => new FormControl(initial, { nonNullable: true });

/** What each conversion means, in the owner's words - shown beside its label field. */
const CONVERSIONS: { event: ConversionEvent; title: string; when: string }[] = [
  { event: ConversionEvent.CustomerSignUp, title: 'Traveller signed up', when: 'A new customer verified their phone number.' },
  { event: ConversionEvent.RideRequested, title: 'Ride requested', when: 'A customer sent a ride request to drivers.' },
  { event: ConversionEvent.BookingConfirmed, title: 'Booking confirmed', when: 'A customer accepted a driver’s quote. Sent with the fare as its value.' },
  { event: ConversionEvent.DriverSignUp, title: 'Driver signed up', when: 'A new driver or owner verified their phone number.' },
  { event: ConversionEvent.SubscriptionPurchased, title: 'Plan purchased', when: 'A driver bought a paid plan. Sent with the plan price as its value.' },
];

const PLACEMENTS: { placement: AdPlacement; title: string; where: string }[] = [
  { placement: AdPlacement.HomeStrip, title: 'Home page strip', where: 'Between the towns map and the driver sign-up band.' },
  { placement: AdPlacement.SearchInline, title: 'Search results', where: 'After the first few drivers in “Find a ride”.' },
  { placement: AdPlacement.BookingConfirmation, title: 'Booking confirmation', where: 'Below a confirmed booking.' },
  { placement: AdPlacement.PackageDetail, title: 'Tour page', where: 'At the foot of a sightseeing package.' },
];

const FLAGS: { flag: FeatureFlag; title: string; detail: string }[] = [
  { flag: FeatureFlag.Packages, title: 'Sightseeing packages', detail: 'Show tours and let customers request them.' },
  { flag: FeatureFlag.Outstation, title: 'Outstation trips', detail: 'Accept town-to-town, station and airport requests.' },
  { flag: FeatureFlag.Reviews, title: 'Reviews', detail: 'Collect and display ratings after completed trips.' },
  { flag: FeatureFlag.DriverSignUp, title: 'Driver sign-up', detail: 'Let new drivers and owners register.' },
  { flag: FeatureFlag.Subscriptions, title: 'Paid plans', detail: 'Let drivers buy subscription plans.' },
  { flag: FeatureFlag.FeaturedListings, title: 'Featured listings', detail: 'Let drivers buy featured placement in search.' },
  { flag: FeatureFlag.LocalAds, title: 'Local business adverts', detail: 'Show campaigns from Admin → Adverts on the site.' },
];

const STATE_COPY: Record<IntegrationState, { label: string; tone: string; detail: string }> = {
  not_configured: { label: 'Off', tone: 'neutral', detail: 'No ID saved. Nothing is loaded or sent.' },
  invalid_id: { label: 'Invalid ID', tone: 'danger', detail: 'The saved ID is not in the right format, so it is ignored.' },
  waiting_for_consent: { label: 'Ready — waiting for consent', tone: 'warning', detail: 'Configured. It starts for each visitor once they accept in the privacy banner. You have not accepted in this browser.' },
  active: { label: 'Active', tone: 'success', detail: 'Running in this browser right now.' },
};

/**
 * Admin → Settings.
 *
 * The first section is where the owner switches on Google Analytics, Google
 * Ads conversion tracking and AdSense by pasting account identifiers - no
 * code change, no redeploy. Every identifier may be left empty, which keeps
 * that integration completely off.
 */
@Component({
  selector: 'app-admin-settings',
  imports: [ReactiveFormsModule, Icon, StatePanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class AdminSettings {
  private readonly api = inject(AdminApi);
  private readonly catalog = inject(CatalogApi);
  private readonly auth = inject(AuthStore);
  private readonly config = inject(AppConfigService);
  private readonly toasts = inject(ToastService);
  protected readonly analytics = inject(AnalyticsService);
  protected readonly consent = inject(ConsentStore);

  protected readonly brand = BRAND;
  protected readonly conversions = CONVERSIONS;
  protected readonly placements = PLACEMENTS;
  protected readonly flags = FLAGS;
  protected readonly canEdit = this.auth.hasPermission(Permission.SettingsManage);

  /** Loading the settings also fills the form. */
  protected readonly settings = loader(() => this.api.settings().pipe(tap((s) => this.patch(s))));
  protected readonly regions = signal<Region[]>([]);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<ApiError | null>(null);

  protected readonly form = new FormGroup({
    analytics: new FormGroup({
      ga4MeasurementId: text([emptyOr(GA4_MEASUREMENT_ID_PATTERN)]),
      googleAdsId: text([emptyOr(GOOGLE_ADS_ID_PATTERN)]),
      labels: new FormGroup(
        Object.fromEntries(CONVERSIONS.map((c) => [c.event, text([emptyOr(GOOGLE_ADS_CONVERSION_LABEL_PATTERN)])])) as Record<
          ConversionEvent,
          FormControl<string>
        >,
      ),
      adsensePublisherId: text([emptyOr(ADSENSE_PUBLISHER_ID_PATTERN)]),
      slots: new FormGroup(
        Object.fromEntries(PLACEMENTS.map((p) => [p.placement, text([emptyOr(ADSENSE_SLOT_ID_PATTERN)])])) as Record<
          AdPlacement,
          FormControl<string>
        >,
      ),
      requireConsent: flag(true),
      debugMode: flag(false),
    }),
    features: new FormGroup(
      Object.fromEntries(FLAGS.map((f) => [f.flag, flag(true)])) as Record<FeatureFlag, FormControl<boolean>>,
    ),
    support: new FormGroup({
      phone: text([emptyOr(INDIAN_MOBILE_E164)]),
      whatsapp: text([emptyOr(INDIAN_MOBILE_E164)]),
      email: text([Validators.email]),
    }),
    bookingFee: new FormGroup({
      enabled: flag(false),
      flatRupees: new FormControl<number | null>(0, [Validators.min(0), Validators.max(10_000)]),
      percent: new FormControl<number | null>(0, [Validators.min(0), Validators.max(20)]),
      capRupees: new FormControl<number | null>(null, [Validators.min(0), Validators.max(100_000)]),
    }),
    defaultRegionSlug: text([Validators.required]),
  });

  /** Re-evaluated on every keystroke so warnings and previews stay live. */
  private readonly value = toSignal(this.form.valueChanges.pipe(startWith(null)), { initialValue: null });

  /** Labels typed without a tag ID do nothing - say so rather than silently ignore them. */
  protected readonly labelsWithoutTag = computed(() => {
    this.value();
    const a = this.form.controls.analytics.getRawValue();
    return !a.googleAdsId.trim() && Object.values(a.labels).some((v) => v.trim());
  });
  protected readonly slotsWithoutPublisher = computed(() => {
    this.value();
    const a = this.form.controls.analytics.getRawValue();
    return !a.adsensePublisherId.trim() && Object.values(a.slots).some((v) => v.trim());
  });
  protected readonly consentOff = computed(() => {
    this.value();
    return !this.form.controls.analytics.controls.requireConsent.value;
  });

  /** What the configured fee would come to on a Rs 1,000 fare. */
  protected readonly feePreview = computed(() => {
    this.value();
    const fee = this.form.controls.bookingFee.getRawValue();
    if (!fee.enabled) return 'No booking fee is charged.';
    const sample = 100_000;
    let amount = (rupeesToMinor(fee.flatRupees) ?? 0) + Math.round((sample * (fee.percent ?? 0)) / 100);
    const cap = rupeesToMinor(fee.capRupees);
    if (cap !== null && cap > 0) amount = Math.min(amount, cap);
    return `On a ${formatMoney(sample)} fare the customer would pay a ${formatMoney(amount)} booking fee.`;
  });

  protected readonly status = computed(() => {
    const s = this.analytics.status();
    return { ga4: STATE_COPY[s.ga4], googleAds: STATE_COPY[s.googleAds], adsense: STATE_COPY[s.adsense] };
  });

  constructor() {
    if (!this.canEdit) this.form.disable();
    this.settings.load();
    // The public list is enough here and needs no catalogue permission.
    this.catalog.regions().subscribe({ next: (regions) => this.regions.set(regions), error: () => undefined });
  }

  protected invalid(control: AbstractControl): 'true' | null {
    return control.invalid && (control.touched || control.dirty) ? 'true' : null;
  }

  /** IDs are case-sensitive in Google's systems; tidy what was pasted. */
  protected tidy(control: FormControl<string>, upper = false): void {
    const trimmed = control.value.trim();
    control.setValue(upper ? trimmed.toUpperCase() : trimmed);
  }

  protected discard(): void {
    const current = this.settings.data();
    if (current) this.patch(current);
    this.saveError.set(null);
  }

  protected save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving() || !this.canEdit) {
      if (this.form.invalid) this.toasts.error('Some fields need fixing before this can be saved.');
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);

    this.api.saveSettings(this.toSettings()).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.settings.set(saved);
        this.patch(saved);
        // Apply at once in this browser; other visitors pick it up on their next page load.
        this.config.applyPublicConfig(saved);
        this.toasts.success('Settings saved.');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.saveError.set(toApiError(error));
      },
    });
  }

  protected sendTestEvent(): void {
    this.analytics.track('contact_support', { source: 'admin_settings_test' });
    this.toasts.info('Test event sent. Look for “contact_support” in GA4 → Reports → Realtime.');
  }

  private patch(s: PlatformSettings): void {
    this.form.reset({
      analytics: {
        ga4MeasurementId: s.analytics.ga4MeasurementId,
        googleAdsId: s.analytics.googleAdsId,
        labels: Object.fromEntries(
          CONVERSIONS.map((c) => [c.event, s.analytics.googleAdsConversionLabels[c.event] ?? '']),
        ) as Record<ConversionEvent, string>,
        adsensePublisherId: s.analytics.adsensePublisherId,
        slots: Object.fromEntries(PLACEMENTS.map((p) => [p.placement, s.analytics.adsenseSlots[p.placement] ?? ''])) as Record<
          AdPlacement,
          string
        >,
        requireConsent: s.analytics.requireConsent,
        debugMode: s.analytics.debugMode,
      },
      features: s.features,
      support: s.support,
      bookingFee: {
        enabled: s.bookingFee.enabled,
        flatRupees: s.bookingFee.flatMinor / 100,
        percent: s.bookingFee.percent,
        capRupees: s.bookingFee.capMinor === null ? null : s.bookingFee.capMinor / 100,
      },
      defaultRegionSlug: s.defaultRegionSlug,
    });
    if (!this.canEdit) this.form.disable();
  }

  private toSettings(): PlatformSettings {
    const v = this.form.getRawValue();
    const nonEmpty = <K extends string>(record: Record<K, string>): Partial<Record<K, string>> =>
      Object.fromEntries(Object.entries<string>(record).filter(([, value]) => value.trim()).map(([k, value]) => [k, value.trim()])) as Partial<
        Record<K, string>
      >;
    const cap = rupeesToMinor(v.bookingFee.capRupees);
    return {
      analytics: {
        ga4MeasurementId: v.analytics.ga4MeasurementId.trim(),
        googleAdsId: v.analytics.googleAdsId.trim(),
        googleAdsConversionLabels: nonEmpty(v.analytics.labels),
        adsensePublisherId: v.analytics.adsensePublisherId.trim(),
        adsenseSlots: nonEmpty(v.analytics.slots),
        requireConsent: v.analytics.requireConsent,
        debugMode: v.analytics.debugMode,
      },
      features: v.features,
      support: { phone: v.support.phone.trim(), whatsapp: v.support.whatsapp.trim(), email: v.support.email.trim() },
      bookingFee: {
        enabled: v.bookingFee.enabled,
        flatMinor: rupeesToMinor(v.bookingFee.flatRupees) ?? 0,
        percent: v.bookingFee.percent ?? 0,
        capMinor: cap && cap > 0 ? cap : null,
      },
      defaultRegionSlug: v.defaultRegionSlug,
    };
  }
}
