import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, of } from 'rxjs';
import {
  ConversionEvent,
  ErrorCode,
  FeatureFlag,
  MAX_ADVANCE_DAYS,
  MAX_PASSENGERS,
  MIN_ADVANCE_NOTICE_MINUTES,
  REQUEST_TTL_MINUTES,
  TripType,
  type CreateRideRequest,
  type DriverPublicProfile,
  type FareEstimate,
  type Place,
  type TourPackage,
  type VehicleCategory,
} from '@payana/contracts';
import { AnalyticsService } from '@core/analytics/analytics.service';
import { ApiError, toApiError } from '@core/api/api-error';
import { RideRequestsApi } from '@core/api/customer.api';
import { CatalogApi, DriversApi } from '@core/api/public.api';
import { AuthStore } from '@core/auth/auth.store';
import { AppConfigService } from '@core/config/app-config.service';
import { newIdempotencyKey } from '@core/platform/platform';
import { DistancePipe, DurationPipe, MoneyPipe, formatDuration, toLocalInputValue } from '@core/util/format';
import { loader } from '@core/util/loader';
import { placeFromParams, placeToParams } from '@core/util/place-params';
import { Icon, type IconName } from '@ui/icon';
import { LocationPicker } from '@ui/location-picker';
import { StatePanel } from '@ui/primitives';
import { VehicleArt } from '@ui/vehicle-art';

interface TripOption {
  type: TripType;
  label: string;
  icon: IconName;
  blurb: string;
}

const TRIP_OPTIONS: TripOption[] = [
  { type: TripType.Immediate, label: 'Ride now', icon: 'clock', blurb: 'Pickup as soon as a driver can reach you.' },
  { type: TripType.Scheduled, label: 'Book ahead', icon: 'calendar', blurb: 'A local trip at a time you choose.' },
  { type: TripType.Outstation, label: 'Outstation', icon: 'route', blurb: 'To another town, a station or an airport.' },
  { type: TripType.Sightseeing, label: 'Sightseeing', icon: 'compass', blurb: 'A driver for a day of sights.' },
];

/**
 * Ask for a ride. One form covers the four kinds of trip; fields appear and
 * become required as the kind of trip demands.
 *
 * Everything the person has entered is mirrored into the query string, so if
 * they have to sign in part-way they come straight back to a filled form.
 */
@Component({
  selector: 'app-request-new',
  imports: [Icon, LocationPicker, VehicleArt, StatePanel, MoneyPipe, DistancePipe, DurationPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './request-new.html',
  styleUrl: './request-new.scss',
})
export class RequestNew {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogApi);
  private readonly driversApi = inject(DriversApi);
  private readonly requests = inject(RideRequestsApi);
  private readonly auth = inject(AuthStore);
  private readonly config = inject(AppConfigService);
  private readonly analytics = inject(AnalyticsService);

  private readonly initial = this.route.snapshot.queryParamMap;

  protected readonly maxPassengers = MAX_PASSENGERS;
  protected readonly tripOptions = TRIP_OPTIONS.filter(
    (o) =>
      (o.type !== TripType.Outstation || this.config.isEnabled(FeatureFlag.Outstation)) &&
      (o.type !== TripType.Sightseeing || this.config.isEnabled(FeatureFlag.Packages)),
  );

  // --- form state ----------------------------------------------------------------
  protected readonly tripType = signal<TripType>(parseTripType(this.initial.get('type')));
  protected readonly pickup = signal<Place | null>(placeFromParams('from', this.initial));
  protected readonly drop = signal<Place | null>(placeFromParams('to', this.initial));
  protected readonly when = signal(this.initial.get('when') ?? '');
  protected readonly returnWhen = signal(this.initial.get('return') ?? '');
  protected readonly categoryCode = signal(this.initial.get('category') ?? '');
  protected readonly passengers = signal(clamp(Number(this.initial.get('pax')) || 2, 1, MAX_PASSENGERS));
  protected readonly luggage = signal(clamp(Number(this.initial.get('bags')) || 0, 0, 20));
  protected readonly notes = signal('');
  protected readonly targetDriverId = signal<string | null>(this.initial.get('driver'));
  protected readonly packageSlug = signal<string | null>(this.initial.get('package'));

  protected readonly tried = signal(false);
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<ApiError | null>(null);
  /** One key for this form instance: a double-tap or a retry cannot create two requests. */
  private readonly idempotencyKey = newIdempotencyKey();

  // --- reference data ----------------------------------------------------------------
  protected readonly categories = loader(() => this.catalog.vehicleCategories());
  protected readonly targetDriver = signal<DriverPublicProfile | null>(null);
  protected readonly tourPackage = signal<TourPackage | null>(null);
  protected readonly estimate = signal<FareEstimate | null>(null);

  protected readonly isImmediate = computed(() => this.tripType() === TripType.Immediate);
  protected readonly isOutstation = computed(() => this.tripType() === TripType.Outstation);
  protected readonly dropRequired = computed(() => !(this.tripType() === TripType.Sightseeing && this.tourPackage()));
  protected readonly activeTrip = computed(() => TRIP_OPTIONS.find((o) => o.type === this.tripType())!);
  protected readonly category = computed<VehicleCategory | null>(
    () => this.categories.data()?.find((c) => c.code === this.categoryCode()) ?? null,
  );
  protected readonly replyWindow = computed(() => formatDuration(REQUEST_TTL_MINUTES[this.tripType()]));

  protected readonly minWhen = computed(() => toLocalInputValue(new Date(Date.now() + MIN_ADVANCE_NOTICE_MINUTES * 60_000)));
  protected readonly maxWhen = computed(() => toLocalInputValue(new Date(Date.now() + MAX_ADVANCE_DAYS * 86_400_000)));

  // --- validation: one message per field, shown after the first submit attempt ----------
  protected readonly errors = computed(() => {
    const e: Partial<Record<'pickup' | 'drop' | 'when' | 'return' | 'category' | 'passengers', string>> = {};
    if (!this.pickup()) e.pickup = 'Choose where you want to be picked up.';
    if (this.dropRequired() && !this.drop()) e.drop = 'Choose where you are going.';

    if (!this.isImmediate()) {
      const at = parseLocal(this.when());
      if (!at) e.when = 'Choose a pickup date and time.';
      else if (at.getTime() < Date.now() + MIN_ADVANCE_NOTICE_MINUTES * 60_000 - 60_000) {
        e.when = `Pickup must be at least ${MIN_ADVANCE_NOTICE_MINUTES} minutes from now. For sooner, use “Ride now”.`;
      } else if (at.getTime() > Date.now() + MAX_ADVANCE_DAYS * 86_400_000) {
        e.when = `You can book up to ${MAX_ADVANCE_DAYS} days ahead.`;
      }
      const back = parseLocal(this.returnWhen());
      if (this.isOutstation() && this.returnWhen() && (!back || !at || back <= at)) {
        e.return = 'The return has to be after the pickup.';
      }
    }

    const category = this.category();
    if (!category) e.category = 'Choose a type of vehicle.';
    else if (this.passengers() > category.seats) {
      e.passengers = `${category.name} seats ${category.seats}. Choose a larger vehicle or fewer passengers.`;
    }
    return e;
  });
  protected readonly valid = computed(() => Object.keys(this.errors()).length === 0);
  protected show(field: keyof ReturnType<typeof this.errors>): string {
    return this.tried() ? (this.errors()[field] ?? '') : '';
  }

  constructor() {
    this.categories.load();
    if (!this.tripOptions.some((o) => o.type === this.tripType())) this.tripType.set(TripType.Immediate);

    const driverId = this.targetDriverId();
    if (driverId) {
      this.driversApi.profile(driverId).subscribe({
        next: (driver) => {
          this.targetDriver.set(driver);
          if (!this.categoryCode()) this.categoryCode.set(driver.vehicle.categoryCode);
        },
        // The driver may no longer be listed: fall back to asking everyone.
        error: () => this.targetDriverId.set(null),
      });
    }

    const slug = this.packageSlug();
    if (slug) {
      this.tripType.set(TripType.Sightseeing);
      this.catalog.package(slug).subscribe({
        next: (pkg) => this.tourPackage.set(pkg),
        error: () => this.packageSlug.set(null),
      });
    }

    // Keep the URL in step with the form (replaceUrl: no history spam).
    effect(() => {
      const queryParams = {
        type: this.tripType(),
        ...emptyPlace('from'),
        ...emptyPlace('to'),
        ...placeToParams('from', this.pickup()),
        ...placeToParams('to', this.drop()),
        when: this.when() || null,
        return: this.returnWhen() || null,
        category: this.categoryCode() || null,
        pax: String(this.passengers()),
        bags: this.luggage() ? String(this.luggage()) : null,
        driver: this.targetDriverId(),
        package: this.packageSlug(),
      };
      untracked(() => void this.router.navigate([], { relativeTo: this.route, queryParams, replaceUrl: true }));
    });

    // A rough price range as soon as both ends and a vehicle are known.
    effect(() => {
      const from = this.pickup();
      const to = this.drop();
      const code = this.categoryCode();
      if (!from || !to || !code) {
        this.estimate.set(null);
        return;
      }
      const sub = this.catalog
        .fareEstimate(from.location, to.location, code)
        .pipe(catchError(() => of(null)))
        .subscribe((estimate) => this.estimate.set(estimate));
      return () => sub.unsubscribe();
    });
  }

  protected setTripType(type: TripType): void {
    this.tripType.set(type);
    if (type === TripType.Immediate) {
      this.when.set('');
      this.returnWhen.set('');
    }
  }

  protected step(target: 'passengers' | 'luggage', delta: number): void {
    if (target === 'passengers') this.passengers.update((n) => clamp(n + delta, 1, MAX_PASSENGERS));
    else this.luggage.update((n) => clamp(n + delta, 0, 20));
  }

  protected askEveryone(): void {
    this.targetDriverId.set(null);
    this.targetDriver.set(null);
  }

  protected submit(): void {
    this.tried.set(true);
    if (!this.valid() || this.submitting()) {
      // Take the person to the first problem rather than leaving them hunting.
      queueMicrotask(() => document.querySelector('[data-invalid="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      return;
    }

    if (!this.auth.isAuthenticated()) {
      // The form is in the URL, so signing in brings them back to it filled in.
      void this.router.navigate(['/sign-in'], { queryParams: { returnUrl: this.router.url } });
      return;
    }

    const body: CreateRideRequest = {
      tripType: this.tripType(),
      pickup: this.pickup()!,
      drop: this.drop() ?? undefined,
      scheduledAt: this.isImmediate() ? undefined : parseLocal(this.when())!.toISOString(),
      returnAt: this.isOutstation() && this.returnWhen() ? parseLocal(this.returnWhen())!.toISOString() : undefined,
      categoryCode: this.categoryCode(),
      passengers: this.passengers(),
      luggage: this.luggage() || undefined,
      notes: this.notes().trim() || undefined,
      packageId: this.tourPackage()?.id,
      targetDriverId: this.targetDriverId() ?? undefined,
    };

    this.submitting.set(true);
    this.submitError.set(null);
    this.requests.create(body, this.idempotencyKey).subscribe({
      next: (request) => {
        this.analytics.track('ride_requested', { trip_type: body.tripType, vehicle_category: body.categoryCode });
        this.analytics.conversion(ConversionEvent.RideRequested, { transactionId: request.id });
        void this.router.navigate(['/requests', request.id]);
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        const e = toApiError(error);
        // The session ended while the form was open: sign in and come back.
        if (e.is(ErrorCode.Unauthenticated) || e.is(ErrorCode.TokenExpired)) {
          void this.router.navigate(['/sign-in'], { queryParams: { returnUrl: this.router.url } });
          return;
        }
        this.submitError.set(e);
      },
    });
  }
}

function parseTripType(value: string | null): TripType {
  return (Object.values(TripType) as string[]).includes(value ?? '') ? (value as TripType) : TripType.Immediate;
}

/** Local "YYYY-MM-DDTHH:mm" from a datetime-local input -> Date, or null. */
function parseLocal(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Explicit nulls so a cleared place is also removed from the URL. */
function emptyPlace(prefix: 'from' | 'to'): Record<string, null> {
  return { [prefix]: null, [`${prefix}Lat`]: null, [`${prefix}Lng`]: null, [`${prefix}Region`]: null };
}
